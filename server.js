require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const MarkovChain = require('markovchain');

const app = express();
const port = process.env.PORT || 3000;

// Middleware to force JSON responses
app.use((req, res, next) => {
    res.header('Content-Type', 'application/json');
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
function sendJsonResponse(res, status, data) {
    return res.status(status).type('json').send(JSON.stringify(data, null, 2));
}

app.post('/generate-markov', async (req, res) => {
    try {
        const { channelId } = req.body || {};
        
        if (!channelId || channelId !== '752106070532554833') {
            return sendJsonResponse(res, 400, { error: 'Invalid channel ID' });
        }

        const channel = await discordClient.channels.fetch(channelId);
        
        if (!channel?.isTextBased()) {
            return sendJsonResponse(res, 400, { error: 'Not a text channel' });
        }

        const permissions = channel.permissionsFor(discordClient.user);
        if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) {
            return sendJsonResponse(res, 403, { error: 'Missing permissions' });
        }

        const messages = await fetchMessages(channel);
        if (messages.length < 50) {
            return sendJsonResponse(res, 400, { error: 'Need at least 50 messages' });
        }

        const textData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => msg.content)
            .join(' ');

        const markov = new MarkovChain(textData);
        const generatedText = markov.parse(textData).end(15).process();

        sendJsonResponse(res, 200, {
            markovText: generatedText || "Failed to generate text",
            messageCount: messages.length
        });

    } catch (error) {
        console.error('Error:', error);
        sendJsonResponse(res, 500, { 
            error: error.message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') 
        });
    }
});

// Handle 404s
app.use((req, res) => {
    sendJsonResponse(res, 404, { error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    sendJsonResponse(res, 500, { error: 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
