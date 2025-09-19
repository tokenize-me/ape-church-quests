const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// --- Configuration ---
const {
    // Supabase
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    // Blockchain
    APECHAIN_RPC_URL,
    PRIVATE_KEY,
    CONTRACT_ADDRESS,
} = process.env;

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = [{"inputs":[{"internalType":"address","name":"userInfoTracker_","type":"address"},{"internalType":"address","name":"expBoostManager_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[],"name":"EXP_PER_LEVEL","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"EXP_SCALE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WAGERED_PER_EXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"}],"name":"batchGetLevels","outputs":[{"internalType":"uint256[]","name":"levels","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canGrantBonusEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSetEXPScale","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSpendEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"expBoostManager","outputs":[{"internalType":"contract IEXPBoostManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getCurrentEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevel","outputs":[{"internalType":"uint256","name":"level","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevelAndEXP","outputs":[{"internalType":"uint256","name":"level","type":"uint256"},{"internalType":"uint256","name":"exp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getTotalEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"grantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"oldEXPManager","type":"address"}],"name":"initWagered","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canGrant","type":"bool"}],"name":"setCanGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canSet","type":"bool"}],"name":"setCanSetEXPScale","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"destContract","type":"address"},{"internalType":"bool","name":"canSpend","type":"bool"}],"name":"setCanSpendEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_expBoostManager","type":"address"}],"name":"setEXPBoostManager","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_EXP_SCALE","type":"uint256"}],"name":"setEXP_SCALE","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_userInfoTracker","type":"address"}],"name":"setUserInfoTracker","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"spendEXP","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"totalEXP","type":"uint256"},{"internalType":"uint256","name":"currentEXP","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"userInfoTracker","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"wagered","outputs":[],"stateMutability":"nonpayable","type":"function"}];

// --- Constants ---
const POLLING_INTERVAL = 15000; // 15 seconds
const BONUS_AMOUNT = BigInt("20000");
const MIN_BALANCE = BigInt("1000");

// --- In-Memory Retry Queue ---
// A Set to store user addresses for whom the on-chain tx succeeded but DB update failed.
const dbUpdateRetryQueue = new Set();

// --- Validation ---
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APECHAIN_RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

// --- Initialization ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * The main function that initializes clients and starts the bot.
 */
async function main() {
    console.log("🚀 Starting Supabase Verification Bonus Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${CONTRACT_ADDRESS}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollDatabaseAndProcessUsers(contract) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for eligible users...`);

    try {
        // 1. First, try to process any users in the DB update retry queue.
        if (dbUpdateRetryQueue.size > 0) {
            console.log(`🔁 Retrying database updates for ${dbUpdateRetryQueue.size} user(s)...`);
            for (const userAddress of Array.from(dbUpdateRetryQueue)) {
                const { error: updateError } = await supabase
                    .from('users')
                    .update({ received_verification_bonus: true })
                    .eq('user_address', userAddress);

                if (updateError) {
                    console.error(`🚨 DB update retry failed for ${userAddress}:`, updateError.message);
                } else {
                    console.log(`🎉 Successfully updated bonus status for ${userAddress} on retry.`);
                    dbUpdateRetryQueue.delete(userAddress); // Remove from queue on success
                }
            }
        }

        // 2. Find new users who are eligible.
        const { data: users, error: selectError } = await supabase
            .from('users')
            .select('user_address, x_handle')
            .eq('x_verified', true)
            .eq('received_verification_bonus', false);

        if (selectError) {
            throw new Error(`Error fetching users from Supabase: ${selectError.message}`);
        }

        const usersToProcess = users.filter(user => !dbUpdateRetryQueue.has(user.user_address));

        if (usersToProcess.length === 0) {
            console.log("✅ No new users to process.");
        } else {
            console.log(`✨ Found ${usersToProcess.length} new user(s) to process.`);

            // 3. Loop through each eligible user and process them.
            for (const user of usersToProcess) {
                console.log(`\nProcessing user: ${user.x_handle} (${user.user_address})`);

                // 3a. Pre-flight check: Verify user's balance.
                console.log(`   - Checking balance for ${user.user_address}...`);
                const balance = await contract.balanceOf(user.user_address);
                console.log(`   - On-chain balance is: ${balance.toString()}`);

                if (balance <= MIN_BALANCE) {
                    console.log(`   - ⏭️ Skipping user: Balance is not > ${MIN_BALANCE}.`);
                    continue; // Skip to the next user
                }
                
                // 3b. Execute the smart contract function.
                const transactionSuccess = await executeBonusTransaction(contract, user.user_address);

                // 3c. If the transaction was successful, update the database.
                if (transactionSuccess) {
                    const { error: updateError } = await supabase
                        .from('users')
                        .update({ received_verification_bonus: true })
                        .eq('user_address', user.user_address);

                    if (updateError) {
                        console.error(`🚨 CRITICAL: DB update failed for ${user.user_address} after successful transaction. Adding to retry queue.`);
                        dbUpdateRetryQueue.add(user.user_address); // Add to retry queue on failure
                    } else {
                        console.log(`🎉 Successfully granted bonus and updated DB for ${user.user_address}.`);
                    }
                } else {
                    console.warn(`   - Skipping database update for ${user.user_address} due to transaction failure.`);
                }
            }
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
 * @param {string} userAddress The address of the user to receive the bonus.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeBonusTransaction(contract, userAddress) {
    try {
        console.log(`   - Attempting to grant ${BONUS_AMOUNT} EXP to ${userAddress}...`);

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        // Estimate gas
        const gasEstimate = await contract.grantBonusEXP.estimateGas(userAddress, BONUS_AMOUNT);
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer
        console.log(`   - Estimated gas: ${gasEstimate}, Gas limit with buffer: ${gasLimitWithBuffer}`);

        // Send the transaction
        const tx = await contract.grantBonusEXP(userAddress, BONUS_AMOUNT, {
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