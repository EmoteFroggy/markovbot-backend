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
        // Preserve custom Discord emojis (convert to :name: format)
        .replace(/<a?:([\w_]+):\d+>/g, ':$1:')
        // Remove user/@ mentions, channel mentions, and role mentions
        .replace(/<[@#!&]\d+>/g, '')
        // Remove URLs but keep surrounding text
        .replace(/https?:\/\/\S+/gi, '')
        // Remove special characters except those needed for text/emojis
        .replace(/[^\w\s'.,!?:\/]/g, '')
        // Clean up whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchMessages(channel) {
    let messages = [];
    let lastId = null;
    
    try {
        while (messages.length < 2000) { // Increased to 2000 messages max
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if (batch.size < 100) break;
            lastId = batch.last()?.id;

            // Add slight delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
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
        if (messages.length < 150) {
            return res.status(400).json({ error: 'Need at least 150 messages' });
        }

        // Process messages with emoji preservation
        const trainingData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => {
                const cleaned = cleanContent(msg.content);
                // Preserve case for emojis, lowercase other text
                return cleaned.includes(':') 
                    ? cleaned 
                    : cleaned.toLowerCase();
            })
            .filter(text => text.length > 0);

        // Create Markov generator with optimized settings
        const markov = new Markov({
            input: trainingData,
            minLength: 8,
            maxLength: 25,
            stateSize: 2, // Bigrams for better emoji context
            maxAttempts: 50
        });

        // Generate text with emoji support
        let generatedText;
        try {
            generatedText = markov.makeChain();
            // Ensure at least 10 words (including emojis as "words")
            const words = generatedText.split(/\s+/);
            if (words.length < 10) {
                generatedText = markov.makeChain();
            }
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
