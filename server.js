require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { spawn } = require('child_process'); // <-- Require child_process

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

// Clean URLs from messages
function cleanContent(text) {
    return text
        .replace(/https?:\/\/\S+/gi, '') // Remove URLs
        .replace(/\s+/g, ' ')            // Remove extra spaces
        .trim();
}

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

// Function to call the Python script with the text corpus
function generateMarkovText(corpus, endCount = 25) {
    return new Promise((resolve, reject) => {
        // Adjust the python command if needed (e.g., 'python3' on some systems)
        const pythonProcess = spawn('python', ['markovify_generator.py', '--end', endCount]);
        
        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(errorOutput));
            }
            resolve(output.trim());
        });

        // Write the corpus to the python process’s stdin
        pythonProcess.stdin.write(corpus);
        pythonProcess.stdin.end();
    });
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

        // Clean and prepare text data
        const textData = messages
            .filter(msg => !msg.author.bot && msg.content.trim())
            .map(msg => cleanContent(msg.content))
            .join(' ');

        // Use the Python script to generate Markov text
        let generatedText = await generateMarkovText(textData, 25);

        // Post-processing similar to before:
        generatedText = generatedText
            .replace(/https?:\/\/\S+/gi, '') // Remove any remaining URLs
            .replace(/\s+/g, ' ')            // Collapse multiple spaces
            .trim();

        // Ensure minimum 15 words and sentence completion
        const words = generatedText.split(/\s+/);
        let finalText = generatedText;
        
        if (words.length >= 15) {
            // Find last sentence-ending punctuation
            const lastPunctuation = Math.max(
                generatedText.lastIndexOf('.'),
                generatedText.lastIndexOf('!'),
                generatedText.lastIndexOf('?')
            );

            if (lastPunctuation > 0) {
                finalText = generatedText.substring(0, lastPunctuation + 1);
            } else {
                // Add period if no punctuation found
                finalText = words.slice(0, 15).join(' ') + '...';
            }
        } else {
            // Fallback: if the generated text is too short, use a simple truncation
            finalText = words.slice(0, 15).join(' ') + '...';
        }

        res.json({
            markovText: finalText,
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
