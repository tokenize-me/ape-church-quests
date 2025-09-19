const { ethers } = require('ethers');
require('dotenv').config(); // This loads environment variables from a .env file

// --- Configuration ---
// Load configuration from environment variables for security and flexibility.
// Make sure you have a .env file in the same directory with these variables defined.
const APECHAIN_RPC_URL = process.env.APECHAIN_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// The Application Binary Interface (ABI) of your smart contract.
// You need to replace this with the actual ABI of your contract.
// This example includes a placeholder for the two functions we'll interact with.
const CONTRACT_ABI = [
    {"inputs":[{"internalType":"address","name":"history_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"gameId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"requestId","type":"uint256"}],"name":"DoubleResolution","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"GameStarted","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"gameId","type":"uint256"},{"indexed":false,"internalType":"address","name":"winner","type":"address"},{"indexed":false,"internalType":"uint256","name":"WIN_AMOUNT","type":"uint256"}],"name":"GameWon","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"RandomnessRequested","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"gameId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"requestId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"randomWord","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"randomNo","type":"uint256"}],"name":"ZeroWinner","type":"event"},{"inputs":[],"name":"GAME_DURATION","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"GAME_ID","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"TICKET_PRICE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256[]","name":"gameIds","type":"uint256[]"}],"name":"batchEssentialGameInfo","outputs":[{"internalType":"address[]","name":"winners","type":"address[]"},{"internalType":"uint256[]","name":"potWon","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"currentGameId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"userRandomWord","type":"bytes32"}],"name":"endGame","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint64","name":"requestId","type":"uint64"},{"internalType":"uint256[]","name":"randomWords","type":"uint256[]"}],"name":"fulfillRandomWords","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"getCurrentGameAndPlayerInfo","outputs":[{"internalType":"address[]","name":"players","type":"address[]"},{"internalType":"uint256[]","name":"ticketsPerPlayer","type":"uint256[]"},{"internalType":"address","name":"winner","type":"address"},{"internalType":"uint256","name":"totalTickets","type":"uint256"},{"internalType":"uint256","name":"startTime","type":"uint256"},{"internalType":"uint256","name":"endTime","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256[]","name":"gameIds","type":"uint256[]"}],"name":"getEssentialGameInfo","outputs":[{"internalType":"address[]","name":"players","type":"address[]"},{"internalType":"uint256[]","name":"buyInAmounts","type":"uint256[]"},{"internalType":"uint256[]","name":"totalPayouts","type":"uint256[]"},{"internalType":"uint256[]","name":"timestamps","type":"uint256[]"},{"internalType":"bool[]","name":"hasEndeds","type":"bool[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getGameAndPlayerInfo","outputs":[{"internalType":"address[]","name":"players","type":"address[]"},{"internalType":"uint256[]","name":"ticketsPerPlayer","type":"uint256[]"},{"internalType":"address","name":"winner","type":"address"},{"internalType":"uint256","name":"totalTickets","type":"uint256"},{"internalType":"uint256","name":"startTime","type":"uint256"},{"internalType":"uint256","name":"endTime","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getGameInfo","outputs":[{"internalType":"address[]","name":"players","type":"address[]"},{"internalType":"address","name":"winner","type":"address"},{"internalType":"uint256","name":"totalTickets","type":"uint256"},{"internalType":"uint256","name":"startTime","type":"uint256"},{"internalType":"uint256","name":"endTime","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"getPot","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"history","outputs":[{"internalType":"contract IHistoryManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"numUsedGameIDs","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"paused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"platformFee","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"ref","type":"address"}],"name":"play","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint8","name":"platformFee_","type":"uint8"}],"name":"setFees","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_gameDuration","type":"uint256"}],"name":"setGameDuration","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bool","name":"_paused","type":"bool"}],"name":"setPaused","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_ticketPrice","type":"uint256"}],"name":"setTicketPrice","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"gameId","type":"uint256"}],"name":"timeLeftInGame","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"stateMutability":"payable","type":"receive"}
];


// --- Validation ---
// Ensure all required environment variables are set before starting.
if (!APECHAIN_RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    console.error("Missing required environment variables. Please check your .env file.");
    process.exit(1); // Exit the script if configuration is missing
}


// --- Main Bot Logic ---

/**
 * The main function that sets up the provider, wallet, and contract,
 * and then starts the monitoring loop.
 */
async function main() {
    console.log("🚀 Starting Ape Chain Monitoring Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${CONTRACT_ADDRESS}`);

    // Start the polling loop
    console.log(`🔍 Starting the polling loop...`);
    pollAndExecute(contract);
}

/**
 * Polls the smart contract and executes a transaction if conditions are met.
 * This function uses a recursive setTimeout to avoid overlapping executions.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollAndExecute(contract) {
    const pollInterval = 40000; // 40 seconds
    const retryInterval = 3000; // 3 seconds

    try {
        console.log("Polling for game state...");
        const currentGameId = await contract.currentGameId();
        const timeLeft = await contract.timeLeftInGame(currentGameId);
        const gameInfo = await contract.getGameInfo(currentGameId);
        const startTime = gameInfo.startTime;

        console.log(`   - Current Game ID: ${currentGameId}`);
        console.log(`   - Time left in current game: ${timeLeft} seconds`);
        console.log(`   - Game Start Time: ${startTime}`);

        // Condition: Game has started and is in its final 90 seconds (or is over).
        if (startTime > BigInt(0) && timeLeft < BigInt(90)) {
            // Game is active and ending soon. We will stop polling and wait for the precise moment to execute.
            const waitTimeMs = (parseInt(timeLeft.toString()) + 1.5) * 1000;

            console.log(`   - Condition met. Waiting ${waitTimeMs / 1000} seconds to spin wheel...`);
            await new Promise(resolve => setTimeout(resolve, waitTimeMs));

            console.log("   - Time is up, attempting to spin wheel...");
            const success = await executeTransaction(contract);
            if (success) {
                // After execution, schedule the next poll.
                console.log("   - Wheel spun successfully! Resuming polling.");
                setTimeout(() => pollAndExecute(contract), pollInterval);
            } else {
                // Something went wrong, use retry interval
                console.log("   - Wheel spun failed! Polling at retry interval:");
                setTimeout(() => pollAndExecute(contract), retryInterval);
            }

        } else {
            // Game is not in an actionable state. Continue with normal polling.
            console.log(`   - Game not actionable. Polling again in ${pollInterval / 1000} seconds.`);
            setTimeout(() => pollAndExecute(contract), pollInterval);
        }

    } catch (error) {
        console.error("   - An error occurred during polling:", error.message);
        // On error, wait for the poll interval before trying again to avoid spamming the RPC endpoint.
        console.log(`   - Retrying in ${retryInterval / 1000} seconds due to error.`);
        setTimeout(() => pollAndExecute(contract), retryInterval);
    }
}


/**
 * Executes the write transaction on the smart contract.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function executeTransaction(contract) {
    try {
        const randomWord = ethers.hexlify(ethers.randomBytes(32));

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");
        
        const gasEstimate = await contract.endGame.estimateGas(randomWord);
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100);
        console.log(`   - Estimated gas: ${gasEstimate.toString()}`);
        console.log(`   - Gas Limit with Buffer: ${gasLimitWithBuffer}`);

        const tx = await contract.endGame(randomWord, {
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: feeData.maxFeePerGas,
        });

        console.log(`   - Transaction sent! Hash: ${tx.hash}`);
        console.log("   - Waiting for transaction to be mined...");

        const receipt = await tx.wait();
        console.log(`🎉 Transaction Mined! Block number: ${receipt.blockNumber}`);
        return true;

    } catch (error) {
        if (error.code === 'CALL_EXCEPTION' || error.reason) {
            console.warn(`   - Transaction failed, likely already executed by another bot. Reason: ${error.reason}`);
            return false;
        } else if (error.code === 'INSUFFICIENT_FUNDS') {
            console.error("   - Transaction failed: Insufficient funds for gas * price + value.");
            process.exit(1);
            return false;
        } else {
            console.error("   - An unexpected error occurred during transaction execution:", error);
            return false;
        }
    }
}

// --- Start the Bot ---
main().catch(error => {
    console.error("A critical error occurred in the main function:", error);
});
