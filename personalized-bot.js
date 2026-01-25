const { ethers } = require('ethers');
require('dotenv').config();
const { encodeAbiParameters, zeroAddress } = require('viem');
const { hashMessage } = require('viem');

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    PERSONAL_KEY,
} = process.env;

const ROULETTE = "0x1f48A104C1808eb4107f3999999D36aeafEC56d5";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = ["function play(address player, bytes calldata gameData) external payable"];
// --- Constants ---
const POLLING_INTERVAL = 10_000; // 10 seconds

const CHECK_AMOUNT_UNFORMATTED = "151";
const CHECK_AMOUNT = ethers.parseUnits(CHECK_AMOUNT_UNFORMATTED, "ether");

const BET_AMOUNT_PER = "50";

// --- Validation ---
if (!APECHAIN_RPC_URL || !PERSONAL_KEY) {
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

    const wallet = new ethers.Wallet(PERSONAL_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(ROULETTE, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${ROULETTE}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract, wallet);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollDatabaseAndProcessUsers(contract, wallet) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for Ape balance...`);

    try {
        const apeBalance = await contract.runner.provider.getBalance(wallet.address);
        console.log(`🔍 Ape balance: ${apeBalance}`);
        if (apeBalance >= CHECK_AMOUNT) {
            console.log(`✅ Ape balance is greater than or equal to ${CHECK_AMOUNT_UNFORMATTED} APE`);
            const txOk = await executeGameTransaction(contract, wallet);
            if (!txOk) {
                console.warn("❌ Transaction failed");
            }
        } else {
            console.log(`❌ Ape balance is less than ${CHECK_AMOUNT_UNFORMATTED} APE`);
        }
    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollDatabaseAndProcessUsers(contract, wallet), POLLING_INTERVAL);
}

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeGameTransaction(contract, wallet) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        const vrfFee = BigInt("73211589000000001");

        // const BET_AMOUNT_PER = Math.floor(( parseInt(CHECK_AMOUNT_UNFORMATTED) - 1 ) / 2).toString();

        const BET_NUMBERS = [49, 50];
        const BET_AMOUNTS = [ethers.parseUnits(BET_AMOUNT_PER, "ether"), ethers.parseUnits(BET_AMOUNT_PER, "ether")];

        const totalValue = BET_AMOUNTS.reduce((a, b) => a + b, BigInt(0)) + vrfFee;
        
        // generate random uint256 for the gameId, needs to be bigint
        // hash something to get a random bytes32
        const randomSeed = Math.random().toString(36).substring(2, 15);
        const randomBytes32 = hashMessage(randomSeed);
        const gameId = BigInt(randomBytes32.slice(0, 16));
        const userRandomWord = hashMessage("I like big butts and I cannot lie!!! You mofos cant deny!");

        const encodedData = encodeAbiParameters(
            [
              { name: "gameNumbers", type: "uint8[]" },
              { name: "amounts", type: "uint256[]" },
              { name: "gameId", type: "uint" },
              { name: "ref", type: "address" },
              { name: "randomWord", type: "bytes32" },
            ],
            [
            BET_NUMBERS,
            BET_AMOUNTS,
              gameId,
              zeroAddress,
              userRandomWord,
            ]
          );

        // Estimate gas
        const gasEstimate = await contract.play.estimateGas(wallet.address, encodedData, { value: totalValue });
        const gasLimitWithBuffer = (gasEstimate * BigInt(110)) / BigInt(100); // 20% buffer
        console.log(`   - Estimated gas: ${gasEstimate}, Gas limit with buffer: ${gasLimitWithBuffer}`);

        // Send the transaction
        const tx = await contract.play(wallet.address, encodedData, { 
            value: totalValue,
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: feeData.maxFeePerGas
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