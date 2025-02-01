require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const MarkovChain = require('markovchain');

const app = express();
const port = process.env.PORT || 3000;

// Force JSON responses for all endpoints
app.use((req, res, next) => {
    res.header('Content-Type', 'application/json');
    res.header('Accept', 'application/json');
    next();
});

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

async function fetchMessages(channel) {
    let messages = [];
    let lastId = null;
    
    try {
        while (messages.length < 500) {
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

// Unified JSON response handler
const jsonResponse = (res, status, data) => {
    return res.status(status).send(JSON.stringify(data, null, 2));
};

app.post('/api/generate', async (req, res) => {
    try {
        const { channelId } = req.body || {};
        
        if (!channelId || channelId !== '752106070532554833') {
            return jsonResponse(res, 400, { error: 'Invalid channel ID' });
        }

        const channel = await discordClient.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            return jsonResponse(res, 400, { error: 'Not a text channel' });
        }

        const permissions = channel.permissionsFor(discordClient.user);
        if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            return jsonResponse(res, 403, { error: 'Missing permissions' });
        }

        const messages = await fetchMessages(channel);
        if (messages.length < 50) {
            return jsonResponse(res, 400, { error: 'Need at least 50 messages' });
        }

        const textData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => msg.content)
            .join(' ');

        const markov = new MarkovChain(textData);
        const generatedText = markov.parse(textData).end(15).process();

        jsonResponse(res, 200, {
            markovText: generatedText || "Failed to generate text",
            messageCount: messages.length
        });

    } catch (error) {
        console.error('Error:', error);
        jsonResponse(res, 500, { 
            error: error.message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') 
        });
    }
});

// Handle 404
app.use('*', (req, res) => {
    jsonResponse(res, 404, { error: 'Endpoint not found' });
});

// Handle errors
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    jsonResponse(res, 500, { error: 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
