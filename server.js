require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const Markov = require('markov-generator');
const fs = require('fs');
const path = require('path');

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

// Log directory
const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)){
    fs.mkdirSync(logDirectory);
}

// Log file
const logFile = path.join(logDirectory, 'generations.log');

function logGeneration(username, generatedText) {
    const logEntry = `${new Date().toISOString()} - User: ${username} - Generated Text: ${generatedText}\n`;
    fs.appendFile(logFile, logEntry, (err) => {
        if (err) {
            console.error('Error logging generation:', err);
        }
    });
}

// Function to update training data with new messages
async function updateTrainingData(channelId) {
    const cache = cachedTrainingData[channelId];
    if (!cache) return;

    const channel = await discordClient.channels.fetch(channelId);
    let messages = [];
    let lastId = cache.data[cache.data.length - 1]?.id || null; // Get the ID of the last cached message

    try {
        while (messages.length < 2000) {
            const options = { limit: 100 };
            if (lastId) options.after = lastId; // Fetch messages after the last cached message
            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if (batch.size < 100) break; // Stop if fewer than 100 messages are fetched
            lastId = batch.last()?.id; // Update lastId to the last message ID in the batch
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait for 200ms before fetching the next batch
        }

        const totalFetched = messages.length;
        console.log(`Total new messages fetched: ${totalFetched}`);

        const newTrainingData = messages
            .filter(msg => !msg.author.bot && msg.content.trim()) // Filter out bot messages and empty messages
            .map(msg => cleanContent(msg.content)) // Clean the message content
            .filter(text => text.length > 0); // Ensure the cleaned text is not empty

        const totalNewFiltered = newTrainingData.length;
        console.log(`Total new messages after filtering: ${totalNewFiltered}`);

        if (totalNewFiltered > 0) {
            const combinedData = [...cache.data, ...newTrainingData];
            if (combinedData.length > 5000) {
                combinedData.splice(0, combinedData.length - 5000); // Trim to 5000 messages
            }
            cachedTrainingData[channelId].data = combinedData; // Update cached data
            cachedTrainingData[channelId].timestamp = Date.now(); // Update the timestamp
        }
    } catch (error) {
        console.error('Failed to update training data:', error);
    }
}

app.post('/api/generate', async (req, res) => {
    try {
        const { channelId, startingWord, username } = req.body || {};
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

        // Update training data with new messages
        await updateTrainingData(channelId);

        const trainingData = cachedTrainingData[channelId].data;
        if (trainingData.length < 150) {
            return res.status(400).json({ error: 'Need at least 150 messages' });
        }

        // Randomly sample a subset of the training data
        const sampledData = getRandomSubset(trainingData, 1000); // Increased subset size

        // Optimized Markov chain parameters
        const markov = new Markov({
            input: sampledData,
            minLength: 50,  // Increased min length for more coherent text
            maxLength: 200, // Increased max length for more detailed text
            stateSize: 3,   // Increased state size for more coherence
            maxAttempts: 100 // Increased max attempts for better coherence
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
            if (words.length < 50) { // Ensure the text meets the minLength requirement
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

        // Log the generation
        if (username) {
            logGeneration(username, generatedText);
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

app.get('/api/logs', (req, res) => {
    fs.readFile(logFile, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).json({ error: 'Failed to read log file' });
        }
        res.set('Content-Type', 'text/plain');
        res.send(data);
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
