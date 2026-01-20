const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    PRIVATE_KEY,
} = process.env;

const FEE_RECEIVER = "0xb36933e6817d31411C47f2Bc2848db1750867923";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = ["function triggerETH() external"];
// --- Constants ---
const POLLING_INTERVAL = 600_000; // 10 minutes

const APE_AMOUNT = ethers.parseUnits("1000", "ether");

// --- Validation ---
if (!APECHAIN_RPC_URL || !PRIVATE_KEY) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}
/**
 * The main function that initializes clients and starts the bot.
 */
async function main() {
    console.log("🚀 Starting Supabase Verification Bonus Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(FEE_RECEIVER, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${FEE_RECEIVER}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollDatabaseAndProcessUsers(contract) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for Ape balance...`);

    try {
        const apeBalance = await contract.runner.provider.getBalance(FEE_RECEIVER);
        console.log(`🔍 Ape balance: ${apeBalance}`);
        if (apeBalance >= APE_AMOUNT) {
            console.log("✅ Ape balance is greater than or equal to 500 APE");
            const txOk = await executeBonusTransaction(contract);
            if (!txOk) {
                console.warn("❌ Transaction failed");
            }
        } else {
            console.log("❌ Ape balance is less than 500 APE");
        }
    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollDatabaseAndProcessUsers(contract), POLLING_INTERVAL);
}

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeBonusTransaction(contract) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        // Estimate gas
        const gasEstimate = await contract.triggerETH.estimateGas();
        const gasLimitWithBuffer = (gasEstimate * BigInt(110)) / BigInt(100); // 20% buffer
        console.log(`   - Estimated gas: ${gasEstimate}, Gas limit with buffer: ${gasLimitWithBuffer}`);

        // Send the transaction
        const tx = await contract.triggerETH({
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