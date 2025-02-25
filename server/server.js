const express = require('express');
const cors = require('cors');
const { AssemblyAI } = require('assemblyai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const aaiClient = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const app = express();
app.use(express.json());
app.use(cors());

// Store conversation histories
const conversations = new Map();

const getSystemPrompt = (callContext) => `You are an expert sales analyst monitoring an ongoing sales conversation in real-time. 
    Your role is to provide valuable insights to the sales representative by analyzing the conversation as it unfolds. 
    Only make updates that help the sales rep. The insights you are providing should be regarding the customer.

    The conversation may or may not be labeled with speakers (Sales Rep: or Customer:) to help you understand who is speaking.
    If the conversations is not labeled, do your best to infer who is speaking.
    You should focus on identifying key information about the prospect, their needs, and potential opportunities while 
    maintaining an organized understanding of the conversation's progress.
    ${callContext ? `\nAdditional context for this specific call: ${callContext}` : ''}`;

const TOOLS = [
  {
    name: "update_summary",
    description: "Add a new bullet point to the conversation summary when there's significant new information. Each bullet should be brief and concise. Only add a new bullet when there's meaningful new information to add.",
    input_schema: {
      type: "object",
      properties: {
        new_point: {
          type: "string",
          description: "A single new bullet point summarizing the latest significant development (without bullet symbol)"
        }
      },
      required: ["new_point"]
    }
  },
  {
    name: "update_bant",
    description: "Update the BANT (Budget, Authority, Need, Timeline) qualification assessment based on the conversation",
    input_schema: {
      type: "object",
      properties: {
        budget: {
          type: "string",
          description: "Identified budget information (anything related to the customers finances) or 'Not identified'"
        },
        authority: {
          type: "string",
          description: "Identified decision-maker information or 'Not identified'"
        },
        need: {
          type: "string",
          description: "Identified business needs or 'Not identified'"
        },
        timeline: {
          type: "string",
          description: "Identified implementation timeline or 'Not identified'"
        }
      },
      required: ["budget", "authority", "need", "timeline"]
    }
  },
  {
    name: "update_company_info",
    description: "Update information about the prospect's or customer's company when new details are discovered. Don't include information on the sales reps company.",
    input_schema: {
      type: "object",
      properties: {
        companyInfo: {
          type: "string",
          description: "Key information about the prospect's company. Don't include information on the sales reps company."
        }
      },
      required: ["companyInfo"]
    }
  },
  {
    name: "update_sales_reminders",
    description: "Add a new bullet point reminder when there's an important new suggestion for the sales representative. Each reminder should be brief and actionable. Only add a new bullet when there's a meaningful new reminder.",
    input_schema: {
      type: "object",
      properties: {
        new_reminder: {
          type: "string",
          description: "A single new bullet point reminder (without bullet symbol)"
        }
      },
      required: ["new_reminder"]
    }
  },
  {
    name: "update_objections",
    description: "Add a new objection and handling strategy when a new customer concern is identified. Only add when there's a clear new objection.",
    input_schema: {
      type: "object",
      properties: {
        new_objection: {
          type: "object",
          properties: {
            objection: {
              type: "string",
              description: "The new customer objection or concern (brief)"
            },
            handling_strategy: {
              type: "string",
              description: "Suggested approach to handle this objection (brief)"
            }
          },
          required: ["objection", "handling_strategy"]
        }
      },
      required: ["new_objection"]
    }
  }
];

app.get('/token', async (req, res) => {
  try {
    const token = await aaiClient.realtime.createTemporaryToken({ expires_in: 3600 });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function executeToolAndGetResult(toolUse) {
  switch (toolUse.name) {
    case 'update_summary':
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "Summary point added successfully"
      };
    case 'update_bant':
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "BANT information updated successfully"
      };
    case 'update_company_info':
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "Company information updated successfully"
      };
    case 'update_sales_reminders':
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "Sales reminder added successfully"
      };
    case 'update_objections':
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "New objection added successfully"
      };
    default:
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: "Tool execution completed"
      };
  }
}

app.post('/process-transcript', async (req, res) => {
  const { transcript, conversationId, callContext } = req.body;
  
  console.log('\n=== New Transcript Processing Request ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Conversation ID:', conversationId);
  console.log('New Transcript:', transcript);
  console.log('Call Context:', callContext || 'None provided');
  
  if (!conversations.has(conversationId)) {
    console.log('Creating new conversation history');
    conversations.set(conversationId, []);
  }
  const conversationHistory = conversations.get(conversationId);
  console.log('Current Conversation History:', JSON.stringify(conversationHistory, null, 2));
  
  // saving conversation logs to view locally
  try {
    const fs = require('fs');
    if (!fs.existsSync('./conversation_logs')) {
      fs.mkdirSync('./conversation_logs');
    }
    fs.writeFileSync(
      `./conversation_logs/${conversationId}.json`, 
      JSON.stringify(conversationHistory, null, 2)
    );
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }

  try {
    // Only add messages that have content
    if (transcript.trim()) {
      const userMessage = {
        role: "user",
        content: `New conversation segment: ${transcript}`
      };
      conversationHistory.push(userMessage);
    }

    // Filter out any messages with empty content before sending to Claude
    const validHistory = conversationHistory.filter(msg => {
      if (Array.isArray(msg.content)) {
        return msg.content.length > 0;
      }
      return msg.content && msg.content.trim().length > 0;
    });

    console.log('\n=== Making Initial Claude Request ===');
    console.log('System Prompt:', getSystemPrompt(callContext));
    console.log('Tools Configuration:', JSON.stringify(TOOLS, null, 2));
    console.log('Valid History:', JSON.stringify(validHistory, null, 2));

    let message = await anthropic.messages.create({
      model: "claude-3-7-sonnet-latest",
      max_tokens: 1024,
      system: getSystemPrompt(callContext),
      tools: TOOLS,
      messages: validHistory
    });

    console.log('\n=== Initial Claude Response ===');
    console.log('Stop Reason:', message.stop_reason);
    console.log('Response Content:', JSON.stringify(message.content, null, 2));

    // Store all updates to be sent to frontend
    const updates = {};

    while (message.stop_reason === 'tool_use') {
      console.log('\n=== Processing Tool Use ===');
      const toolResults = [];
      
      // Process each tool use
      for (const content of message.content) {
        if (content.type === 'tool_use') {
          console.log('Tool Use Request:', JSON.stringify(content, null, 2));
          const result = await executeToolAndGetResult(content);
          console.log('Tool Result:', JSON.stringify(result, null, 2));
          toolResults.push(result);
          // Store update for frontend
          updates[content.name] = content.input;
        }
      }

      console.log('\n=== Updating Conversation History ===');
      // Only add messages if they have content
      if (message.content && message.content.length > 0) {
        const assistantMessage = {
          role: "assistant",
          content: message.content
        };
        conversationHistory.push(assistantMessage);
      }

      if (toolResults.length > 0) {
        const toolResultMessage = {
          role: "user",
          content: toolResults
        };
        conversationHistory.push(toolResultMessage);
      }

      // Filter history again before making next request
      const validHistory = conversationHistory.filter(msg => {
        if (Array.isArray(msg.content)) {
          return msg.content.length > 0;
        }
        return msg.content && msg.content.trim().length > 0;
      });

      console.log('\n=== Making Follow-up Claude Request ===');
      console.log('Valid History:', JSON.stringify(validHistory, null, 2));
      
      // Get next message from Claude
      message = await anthropic.messages.create({
        model: "claude-3-7-sonnet-latest",
        max_tokens: 1024,
        system: getSystemPrompt(callContext),
        tools: TOOLS,
        messages: validHistory
      });

      console.log('\n=== Follow-up Claude Response ===');
      console.log('Stop Reason:', message.stop_reason);
      console.log('Response Content:', JSON.stringify(message.content, null, 2));
    }

    // Add final message to history if it has content
    if (message.stop_reason !== 'tool_use' && message.content && message.content.length > 0) {
      const finalMessage = {
        role: "assistant",
        content: message.content
      };
      console.log('\n=== Adding Final Message to History ===');
      console.log('Final Message:', JSON.stringify(finalMessage, null, 2));
      conversationHistory.push(finalMessage);
    }

    console.log('\n=== Final Updates ===');
    console.log('Updates being sent to frontend:', JSON.stringify(updates, null, 2));

    res.json(updates);
  } catch (error) {
    console.error('\n=== Error Processing Transcript ===');
    console.error('Error:', error);
    console.error('Error Stack:', error.stack);
    console.error('Request Data:', {
      transcript,
      conversationId,
      callContext,
      conversationHistory: JSON.stringify(conversationHistory, null, 2)
    });
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`\n=== Server Started ===`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`AssemblyAI API Key present: ${!!process.env.ASSEMBLYAI_API_KEY}`);
  console.log(`Anthropic API Key present: ${!!process.env.ANTHROPIC_API_KEY}`);
});

module.exports = app;