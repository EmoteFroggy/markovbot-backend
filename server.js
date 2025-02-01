require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const MarkovChain = require('markovchain');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors({ origin: '*' }));
app.use(express.json());

// Discord client setup
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Discord login
discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Login failed:', error);
    process.exit(1);
});

// Optimized message fetching
async function fetchMessages(channel) {
    let messages = [];
    let lastId = null;
    
    try {
        while (messages.length < 500) { // Limited to 500 messages for speed
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if (batch.size < 100) break; // Early exit
            lastId = batch.last()?.id;
        }
        return messages;
    } catch (error) {
        throw new Error('Failed to fetch messages');
    }
}

// Main endpoint
app.post('/generate-markov', async (req, res) => {
    try {
        const { channelId } = req.body;
        
        // Validate channel ID
        if (channelId !== '752106070532554833') {
            return res.status(400).json({ error: 'Invalid channel ID' });
        }

        // Get channel
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            return res.status(400).json({ error: 'Not a text channel' });
        }

        // Check permissions
        const permissions = channel.permissionsFor(discordClient.user);
        if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            return res.status(403).json({ error: 'Missing permissions' });
        }

        // Fetch messages
        const messages = await fetchMessages(channel);
        if (messages.length < 50) {
            return res.status(400).json({ error: 'Need at least 50 messages' });
        }

        // Process messages
        const textData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => msg.content)
            .join(' '); // Using spaces instead of newlines

        // Generate text
        const markov = new MarkovChain(textData);
        const generatedText = markov.parse(textData).end(15).process();

        res.json({
            markovText: generatedText || "Failed to generate text",
            messageCount: messages.length
        });

    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
