const { ethers } = require('ethers');
require('dotenv').config();

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    PRIVATE_KEY,
} = process.env;

const GP_REWARD_MANAGER = "0x3830F86e4eEe01c611512915D12d3BaED7DE2f3E";
const GP_TOKEN = "0x0382338F3876237Ae89317A6a8207C432D430b93";

const REWARD_MANAGER_ABI = ["function distributeRewards() external"];
const GP_TOKEN_ABI = ["function balanceOf(address) external view returns (uint256)"];

// --- Constants ---
const POLLING_INTERVAL = 180_000; // 3 minutes
const MIN_BALANCE = 50_000n;

// --- Validation ---
if (!APECHAIN_RPC_URL || !PRIVATE_KEY) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

/**
 * The main function that initializes clients and starts the bot.
 */
async function main() {
    console.log("🚀 Starting GP Rewards Distribution Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const rewardManager = new ethers.Contract(GP_REWARD_MANAGER, REWARD_MANAGER_ABI, wallet);
    console.log(`📄 Reward Manager loaded at address: ${GP_REWARD_MANAGER}`);

    const gpToken = new ethers.Contract(GP_TOKEN, GP_TOKEN_ABI, provider);
    console.log(`📄 GP Token loaded at address: ${GP_TOKEN}`);

    console.log(`🔍 Starting polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollAndDistribute(rewardManager, gpToken);
}

/**
 * Polls the GP token balance of the reward manager and distributes rewards if eligible.
 * @param {ethers.Contract} rewardManager - The reward manager contract instance (with signer).
 * @param {ethers.Contract} gpToken - The GP token contract instance.
 */
async function pollAndDistribute(rewardManager, gpToken) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for GP balance...`);

    try {
        const gpBalance = await gpToken.balanceOf(GP_REWARD_MANAGER);
        console.log(`🔍 GP balance of Reward Manager: ${gpBalance}`);
        if (gpBalance > MIN_BALANCE) {
            console.log(`✅ GP balance exceeds threshold of ${MIN_BALANCE}`);
            const txOk = await executeDistributeRewards(rewardManager);
            if (!txOk) {
                console.warn("❌ Transaction failed");
            }
        } else {
            console.log(`❌ GP balance is at or below threshold of ${MIN_BALANCE}`);
        }
    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollAndDistribute(rewardManager, gpToken), POLLING_INTERVAL);
}

/**
 * Executes the 'distributeRewards' smart contract function.
 * @param {ethers.Contract} rewardManager The reward manager contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeDistributeRewards(rewardManager) {
    try {
        const feeData = await rewardManager.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        // Estimate gas
        const gasEstimate = await rewardManager.distributeRewards.estimateGas();
        const gasLimitWithBuffer = (gasEstimate * BigInt(110)) / BigInt(100); // 10% buffer
        console.log(`   - Estimated gas: ${gasEstimate}, Gas limit with buffer: ${gasLimitWithBuffer}`);

        // Send the transaction
        const tx = await rewardManager.distributeRewards({
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: feeData.maxFeePerGas,
        });

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
    process.exit(1);
});
