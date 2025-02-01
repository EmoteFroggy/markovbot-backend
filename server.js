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

function cleanContent(text) {
    return text
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/<[@#!?]\d+>/g, '')
        .replace(/[^\w\s'.,!?]/g, '')  // Remove special characters
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(); // Normalize to lowercase for better consistency
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
        if (messages.length < 100) {  // Increased minimum message requirement
            return res.status(400).json({ error: 'Need at least 100 messages' });
        }

        // Prepare training data
        const trainingData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => cleanContent(msg.content))
            .filter(text => text.split(' ').length > 2);  // Filter out short messages

        // Create Markov generator
        const markov = new Markov({
            input: trainingData,
            minLength: 10,    // Minimum words per generated message
            maxLength: 25,    // Maximum words per generated message
            stateSize: 2      // Use bigrams (2-word sequences) for better context
        });

        // Generate multiple candidates and pick the best one
        let generatedText;
        try {
            const candidates = Array(5).fill().map(() => markov.makeChain());
            generatedText = candidates.sort((a, b) => b.length - a.length)[0];
        } catch (error) {
            console.error('Generation failed:', error);
            generatedText = "Failed to generate coherent text";
        }

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
