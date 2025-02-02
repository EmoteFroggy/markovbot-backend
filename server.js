require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Markov = require('markov-generator');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Login failed:', error);
    process.exit(1);
});

let cachedTrainingData = {};

function cleanContent(text) {
    return text
        .replace(/<(@|#|!)\d+>/g, '') // Removed the unnecessary ?
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[^\w\s'.,!?<>:/]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchAndCacheMessages(channelId) {
    const cache = cachedTrainingData[channelId];
    const cacheDuration = 60 * 60 * 1000; // 1 hour

    if (cache && cache.timestamp + cacheDuration > Date.now()) {
        console.log('Using cached data for channel:', channelId);
        return cache.data;
    }

    console.log('Fetching and caching messages for channel:', channelId);
    const channel = await discordClient.channels.fetch(channelId);
    let messages = [];
    let lastId = null;

    try {
        while (messages.length < 2000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if (batch.size < 100) break;
            lastId = batch.last()?.id;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const totalFetched = messages.length;
        console.log(`Total messages fetched: ${totalFetched}`);

        const trainingData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => cleanContent(msg.content))
            .filter(text => text.length > 0);

        const totalFiltered = trainingData.length;
        console.log(`Total messages after filtering: ${totalFiltered}`);

        cachedTrainingData[channelId] = {
            data: trainingData,
            timestamp: Date.now(),
            refreshing: false
        };

        return trainingData;
    } catch (error) {
        cachedTrainingData[channelId].refreshing = false;
        throw new Error('Failed to fetch messages');
    }
}

function getRandomSubset(arr, size) {
    if (arr.length <= size) return arr;
    const shuffled = arr.slice().sort(() => 0.5 - Math.random());
    return shuffled.slice(0, size);
}

app.post('/api/generate', async (req, res) => {
    try {
        const { channelId, startingWord } = req.body || {};
        if (!channelId || channelId !== '752106070532554833') {
            return res.status(400).json({ error: 'Invalid channel ID' });
        }

        const channel = await discordClient.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            return res.status(400).json({ error: 'Not a text channel' });
        }

        const permissions = channel.permissionsFor(discordClient.user);
        if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            return res.status(403).json({ error: 'Missing permissions' });
        }

        const trainingData = await fetchAndCacheMessages(channelId);
        if (trainingData.length < 150) {
            return res.status(400).json({ error: 'Need at least 150 messages' });
        }

        // Randomly sample a subset of the training data
        const sampledData = getRandomSubset(trainingData, 500);

        // Optimized Markov chain parameters
        const markov = new Markov({
            input: sampledData,
            minLength: 25,  // Increased min length for more coherent text
            maxLength: 100, // Increased max length for more detailed text
            stateSize: 3,   // Smaller state size for more uniqueness
            maxAttempts: 200 // Balanced max attempts for better coherence
        });

        let generatedText;
        let attemptCount = 0;
        const maxAttempts = 10; // Maximum number of attempts to generate text without "miku"

        while (attemptCount < maxAttempts) {
            generatedText = markov.makeChain();
            if (startingWord) {
                generatedText = `${startingWord} ${generatedText}`;
            }
            const words = generatedText.split(/\s+/);
            if (words.length < 25) { // Ensure the text meets the minLength requirement
                generatedText = markov.makeChain();
                if (startingWord) {
                    generatedText = `${startingWord} ${generatedText}`;
                }
            } else {
                break;
            }
            attemptCount++;
        }

        if (attemptCount >= maxAttempts) {
            generatedText = "Failed to generate coherent text";
        }

        res.json({
            markovText: generatedText,
            messageCount: trainingData.length,
            lastRefreshed: new Date(cachedTrainingData[channelId].timestamp).toLocaleString()
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cache-status', (req, res) => {
    const channelId = '752106070532554833';
    const cache = cachedTrainingData[channelId];
    if (!cache) {
        return res.json({ lastRefreshed: 'Never', refreshing: false });
    }
    return res.json({
        lastRefreshed: new Date(cache.timestamp).toLocaleString(),
        refreshing: cache.refreshing
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
