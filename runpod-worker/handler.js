const runpod = require('@runpod/serverless');

// This is the stub handler. We will migrate the YOLO and Ollama logic here next.
async function handler(job) {
    const { input } = job;
    console.log("Received job:", input);
    
    try {
        if (input && input.action === 'ping') {
            return { success: true, message: "AI Engine is online and ready!" };
        }
        
        return { success: false, error: "Unknown action requested." };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

runpod.start({ handler });
