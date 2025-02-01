require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const MarkovChain = require('markovchain'); // Changed from markovify to markovchain
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

// Clean messages from URLs and unwanted content
function cleanContent(text) {
    return text
        .replace(/https?:\/\/\S+/gi, '') // Remove URLs
        .replace(/<[@#!?]\d+>/g, '')     // Remove mentions
        .replace(/\s+/g, ' ')            // Collapse whitespace
        .trim();
}

async function fetchMessages(channel) {
    let messages = [];
    let lastId = null;
    
    try {
        while (messages.length < 1000) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if (batch.size < 100) break;
            lastId = batch.last()?.id;
        }
        return messages;
    } catch (error) {
        throw new Error('Failed to fetch messages');
    }
}

app.post('/api/generate', async (req, res) => {
    try {
        const { channelId } = req.body || {};
        
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

        const messages = await fetchMessages(channel);
        if (messages.length < 50) {
            return res.status(400).json({ error: 'Need at least 50 messages' });
        }

        // Build text corpus with sentence splitting
        const textData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => cleanContent(msg.content))
            .join('. ') // Treat each message as potential sentence
            .replace(/([.!?])\s*/g, '$1\n') // Split into sentences
            .split('\n')
            .filter(line => line.trim().length > 0);

        // Create Markov model using markovchain
        const markov = new MarkovChain(textData);
        const generatedText = markov.parse(textData).end(15).process();

        res.json({
            markovText: generatedText,
            messageCount: messages.length
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
