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
} = process.env;

const EXP_MANAGER_CONTRACT_ADDRESS = "0x8046Ac65d2A077562989B2f0770D9bB40e3078CD";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = [{"inputs":[{"internalType":"address","name":"userInfoTracker_","type":"address"},{"internalType":"address","name":"expBoostManager_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[],"name":"EXP_PER_LEVEL","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"EXP_SCALE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WAGERED_PER_EXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"}],"name":"batchGetLevels","outputs":[{"internalType":"uint256[]","name":"levels","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canGrantBonusEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSetEXPScale","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSpendEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"expBoostManager","outputs":[{"internalType":"contract IEXPBoostManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getCurrentEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevel","outputs":[{"internalType":"uint256","name":"level","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevelAndEXP","outputs":[{"internalType":"uint256","name":"level","type":"uint256"},{"internalType":"uint256","name":"exp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getTotalEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"grantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"oldEXPManager","type":"address"}],"name":"initWagered","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canGrant","type":"bool"}],"name":"setCanGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canSet","type":"bool"}],"name":"setCanSetEXPScale","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"destContract","type":"address"},{"internalType":"bool","name":"canSpend","type":"bool"}],"name":"setCanSpendEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_expBoostManager","type":"address"}],"name":"setEXPBoostManager","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_EXP_SCALE","type":"uint256"}],"name":"setEXP_SCALE","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_userInfoTracker","type":"address"}],"name":"setUserInfoTracker","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"spendEXP","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"totalEXP","type":"uint256"},{"internalType":"uint256","name":"currentEXP","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"userInfoTracker","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"wagered","outputs":[],"stateMutability":"nonpayable","type":"function"}];

// --- Constants ---
const POLLING_INTERVAL = 10000; // 10 seconds

// --- In-Memory Retry Queue ---
// A Set to store user addresses for whom the on-chain tx succeeded but DB update failed.
const dbUpdateRetryQueue = new Map();

// --- Validation ---
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APECHAIN_RPC_URL || !PRIVATE_KEY || !EXP_MANAGER_CONTRACT_ADDRESS) {
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

    const contract = new ethers.Contract(EXP_MANAGER_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${EXP_MANAGER_CONTRACT_ADDRESS}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract);
}

/**
 * Polls the database for eligible users and processes them in batches.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollDatabaseAndProcessUsers(contract) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for eligible users...`);

    try {
        // 1. First, try to process any users in the DB update retry queue.
        if (dbUpdateRetryQueue.size > 0) {
            console.log(`🔁 Retrying database updates for ${dbUpdateRetryQueue.size} user(s)...`);
            for (const [queueKey, { userAddress, questId }] of dbUpdateRetryQueue.entries()) {
                const { error: updateError } = await supabase
                    .from('user_x_interaction_quests')
                    .update({
                        received_verification_bonus: true,
                    })
                    .eq('user_address', userAddress)
                    .eq('quest_id', questId);

                if (updateError) {
                    console.error(`🚨 DB update retry failed for ${userAddress}:`, updateError.message);
                } else {
                    console.log(`🎉 Successfully updated questId=${questId} for ${userAddress} on retry.`);
                    dbUpdateRetryQueue.delete(queueKey);
                }
            }
        }

        const { data: quests, error: questsError } = await supabase
            .from("x_interaction_quests")
            .select("id, reward")
            .gt("expires_at", new Date().toISOString())

        if (questsError) {
            throw new Error(`Error fetching quests from Supabase: ${questsError.message}`);
        }

        const { data: users, error: selectError } = await supabase
            .from('user_x_interaction_quests')
            .select('user_address, quest_id')
            .in('quest_id', quests.map(quest => quest.id))
            .eq('completed', true)
            .eq('received_verification_bonus', false)

        if (selectError) {
            throw new Error(`Error fetching users from Supabase: ${selectError.message}`);
        }

        const newUsers = users.filter(user => {
            const queueKey = `${user.user_address}:${user.quest_id}`;
            return !dbUpdateRetryQueue.has(queueKey);
        });

        if (newUsers.length === 0) {
            console.log("✅ No new users to process.");
        } else {
            console.log(`✨ Found ${newUsers.length} total new user(s) to process.`);

            // 4. Group into batches and process
            const TX_BATCH_SIZE = 25;
            let currentBatchUsers = [];
            let currentBatchAmounts = [];
            let currentBatchMeta = [];

            for (const user of newUsers) {
                const amountReward = quests.find(quest => quest.id === user.quest_id)?.reward ?? 0;
                if (amountReward === 0) {
                    console.log(`   - Skipping user: ${user.user_address} - Quest: ${user.quest_id}, Reward: ${amountGP} -> No reward to grant.`);
                    continue;
                }

                currentBatchUsers.push(user.user_address);
                currentBatchAmounts.push(BigInt(amountReward));
                currentBatchMeta.push(user);

                if (currentBatchUsers.length >= TX_BATCH_SIZE) {
                    await processBatch(contract, currentBatchUsers, currentBatchAmounts, currentBatchMeta);
                    currentBatchUsers = [];
                    currentBatchAmounts = [];
                    currentBatchMeta = [];
                }
            }

            // Process remaining
            if (currentBatchUsers.length > 0) {
                await processBatch(contract, currentBatchUsers, currentBatchAmounts, currentBatchMeta);
                currentBatchUsers = [];
                currentBatchAmounts = [];
                currentBatchMeta = [];
            }
        }

    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollDatabaseAndProcessUsers(contract), POLLING_INTERVAL);
}

/**
 * Processes a batch of users: sends transaction and updates DB.
 */
async function processBatch(contract, addresses, amounts, metaData) {
    console.log(`\n🚀 Processing batch of ${addresses.length} users...`);
    
    const txSuccess = await executeBatchBonusTransaction(contract, addresses, amounts);

    if (!txSuccess) {
        console.warn(`❌ Batch transaction failed. Skipping DB updates for this batch.`);
        return;
    }

    console.log(`📝 Updating database for ${metaData.length} users...`);
    
    // Update DB in parallel
    const updatePromises = metaData.map(async (user) => {
        const { error: updateError } = await supabase
            .from('user_x_interaction_quests')
            .update({ received_verification_bonus: true })
            .eq('user_address', user.user_address)
            .eq('quest_id', user.quest_id);

        if (updateError) {
             console.error(`🚨 CRITICAL: DB update failed for ${user.user_address} (Quest ${user.quest_id}). Adding to retry queue.`);
             const queueKey = `${user.user_address}:${user.quest_id}`;
             dbUpdateRetryQueue.set(queueKey, { 
                 userAddress: user.user_address, 
                 questId: user.quest_id 
             });
        }
    });

    await Promise.all(updatePromises);
    console.log(`✅ Batch processing complete.`);
}

/**
 * Executes the 'batchGrantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @param {string[]} users Array of user addresses.
 * @param {BigInt[]} amounts Array of amounts.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeBatchBonusTransaction(contract, users, amounts) {
    try {
        const totalAmount = amounts.reduce((a, b) => a + b, 0n);
        console.log(`   - Attempting to grant total ${totalAmount} EXP to ${users.length} users...`);

        const feeData = await contract.runner.provider.getFeeData();
        /* console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        }); */

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        // Estimate gas
        let gasEstimate;
        try {
            gasEstimate = await contract.batchGrantBonusEXP.estimateGas(users, amounts);
            // console.log(`   - Estimated gas: ${gasEstimate}`);
        } catch (error) {
             console.warn(`   - Gas estimation failed: ${error.message}. Using fallback.`);
             // Fallback: ~100k per user + 100k base
             gasEstimate = BigInt(100000) * BigInt(users.length) + BigInt(100000);
        }
        
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer

        // Send the transaction
        const tx = await contract.batchGrantBonusEXP(users, amounts, {
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: feeData.maxFeePerGas,
        });

        console.log(`   - Batch Tx Sent: ${tx.hash}. Waiting...`);
        const receipt = await tx.wait();
        console.log(`🎉 Batch Transaction Mined! Block number: ${receipt.blockNumber}`);
        return true;

    } catch (error) {
        if (error.code === 'CALL_EXCEPTION' || error.reason) {
            console.warn(`   - Transaction failed. Reason: ${error.reason}`);
            return false;
        } else if (error.code === 'INSUFFICIENT_FUNDS') {
            console.error("   - Transaction failed: Insufficient funds.");
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