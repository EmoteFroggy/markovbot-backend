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
        // Keep original emoji format <:name:id>
        .replace(/<(@|#|!|\?)\d+>/g, '') // Remove other mentions
        .replace(/https?:\/\/\S+/gi, '') // Remove URLs
        .replace(/[^\w\s'.,!?<>:\/]/g, '') // Allow emoji syntax characters
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchMessages(channel){
    let messages = [];
    let lastId = null;
    
    try {
        while(messages.length < 2000) {
            const options = { limit: 100 };
            if(lastId) options.before = lastId;

            const batch = await channel.messages.fetch(options);
            messages.push(...batch.values());
            if(batch.size < 100) break;
            lastId = batch.last()?.id;

            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return messages;
    } catch(error) {
        throw new Error('Failed to fetch messages');
    }
}

app.post('/api/generate', async (req, res) => {
    try {
        const { channelId } = req.body || {};
        
        if(!channelId || channelId !== '752106070532554833') {
            return res.status(400).json({ error: 'Invalid channel ID' });
        }

        const channel = await discordClient.channels.fetch(channelId);
        if(!channel?.isTextBased()) {
            return res.status(400).json({ error: 'Not a text channel' });
        }

        const permissions = channel.permissionsFor(discordClient.user);
        if(!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            return res.status(403).json({ error: 'Missing permissions' });
        }

        const messages = await fetchMessages(channel);
        if(messages.length < 150) {
            return res.status(400).json({ error: 'Need at least 150 messages' });
        }

        const trainingData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => cleanContent(msg.content))
            .filter(text => text.length > 0);

        const markov = new Markov({
            input: trainingData,
            minLength: 15,
            maxLength: 50,
            stateSize: 3,
            maxAttempts: 50
        });

        let generatedText;
        try {
            generatedText = markov.makeChain();
            const words = generatedText.split(/\s+/);
            if(words.length < 10) generatedText = markov.makeChain();
        } catch(error) {
            console.error('Generation failed:', error);
            generatedText = "Failed to generate coherent text";
        }

        res.json({
            markovText: generatedText,
            messageCount: messages.length
        });

    } catch(error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
