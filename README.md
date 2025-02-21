# AI-Powered Real-Time Sales Assistant

This application combines AssemblyAI's Real-time transcription with Claude AI to create an intelligent sales assistant that provides real-time insights and analysis during sales calls.

The app captures audio from either a microphone or uploaded audio file, transcribes it in real-time, and analyzes the conversation to provide valuable sales insights. This includes BANT qualification tracking, company information extraction, sales coaching reminders, and objection handling assistance.

## Key Features

- Real-time speech-to-text transcription
- Live conversation analysis
- BANT (Budget, Authority, Need, Timeline) qualification tracking
- Company information extraction
- Sales coaching reminders
- Objection detection and handling strategies
- Support for both live microphone input and audio file playback
- Context-aware analysis capabilities

## How To Install and Run the Project

##### ❗Important Prerequisites❗

- An upgraded AssemblyAI account (real-time API requires upgraded accounts)
- An Anthropic API key for Claude AI access
- Running without proper API access will cause **errors with 402 status codes** ⚠️

##### Setup Instructions

1. Clone the repo to your local machine.
2. Open a terminal in the project's main directory.
3. Run `npm install` to install all dependencies.
4. Create a `.env` file in the `server` folder with your API keys:

```
ASSEMBLYAI_API_KEY="YOUR-ASSEMBLYAI-API-KEY"
ANTHROPIC_API_KEY="YOUR-ANTHROPIC-API-KEY"
```

You can find your AssemblyAI API key [here](https://www.assemblyai.com/app/account) and obtain an Anthropic API key [here](https://console.anthropic.com/).

5. Start the app with `npm start`. The application will run on port 3000.
6. Open `http://localhost:3000/` in your browser.
7. Optional: Add context about your sales call in the provided text area.
8. Choose your input method (microphone or file upload) and begin recording/playback.

## Usage Tips

- For best audio file results, use 16kHz WAV format
- Add relevant call context before starting to receive more targeted insights
- Monitor the real-time dashboard panels for:
  - Live transcript
  - Conversation summary
  - BANT qualification status
  - Company information
  - Sales reminders
  - Customer objections and handling strategies

## Technical Documentation

- [AssemblyAI Real-Time Documentation](https://www.assemblyai.com/docs/speech-to-text/streaming)
- [Anthropic Claude API Documentation](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [Express Documentation](https://expressjs.com/)
- [React Documentation](https://reactjs.org/)

## Dependencies

- AssemblyAI API for real-time transcription
- Anthropic's Claude API for conversation analysis
- React for frontend interface
- Express for backend server
- RecordRTC for audio handling
- Various React hooks for state management
- Concurrently for running frontend and backend servers
- CORS for API request handling
- dotenv for environment variable management

## Contact & Support

For AssemblyAI related questions:
- Contact AssemblyAI Support: support@assemblyai.com
