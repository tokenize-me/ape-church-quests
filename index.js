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
const USER_INFO_CONTRACT_ADDRESS = "0x6EA76F01Aa615112AB7de1409EFBD80a13BfCC84"

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = [{"inputs":[{"internalType":"address","name":"userInfoTracker_","type":"address"},{"internalType":"address","name":"expBoostManager_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[],"name":"EXP_PER_LEVEL","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"EXP_SCALE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WAGERED_PER_EXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"}],"name":"batchGetLevels","outputs":[{"internalType":"uint256[]","name":"levels","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canGrantBonusEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSetEXPScale","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSpendEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"expBoostManager","outputs":[{"internalType":"contract IEXPBoostManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getCurrentEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevel","outputs":[{"internalType":"uint256","name":"level","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevelAndEXP","outputs":[{"internalType":"uint256","name":"level","type":"uint256"},{"internalType":"uint256","name":"exp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getTotalEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"grantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"oldEXPManager","type":"address"}],"name":"initWagered","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canGrant","type":"bool"}],"name":"setCanGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canSet","type":"bool"}],"name":"setCanSetEXPScale","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"destContract","type":"address"},{"internalType":"bool","name":"canSpend","type":"bool"}],"name":"setCanSpendEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_expBoostManager","type":"address"}],"name":"setEXPBoostManager","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_EXP_SCALE","type":"uint256"}],"name":"setEXP_SCALE","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_userInfoTracker","type":"address"}],"name":"setUserInfoTracker","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"spendEXP","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"totalEXP","type":"uint256"},{"internalType":"uint256","name":"currentEXP","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"userInfoTracker","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"wagered","outputs":[],"stateMutability":"nonpayable","type":"function"}];
const USER_INFO_ABI = [{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"allUsers","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256[]","name":"GAME_IDs","type":"uint256[]"}],"name":"batchGameData","outputs":[{"internalType":"uint256[]","name":"_totalWagered","type":"uint256[]"},{"internalType":"uint256[]","name":"numGamesPlayed","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"pure","type":"function"},{"inputs":[],"name":"expManager","outputs":[{"internalType":"contract IEXPManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"GAME_ID","type":"uint256"}],"name":"getGameData","outputs":[{"internalType":"uint256","name":"_totalWagered","type":"uint256"},{"internalType":"uint256","name":"numGamesPlayed","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"}],"name":"getListOfTotalWagered","outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"startIndex","type":"uint256"},{"internalType":"uint256","name":"endIndex","type":"uint256"}],"name":"getListOfTotalWageredPaginated","outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getTotalWagered","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"contract IOldUserInfo","name":"oldUserInfo","type":"address"},{"internalType":"address","name":"oldEXPManager","type":"address"}],"name":"init","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"listAllUsers","outputs":[{"internalType":"address[]","name":"","type":"address[]"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"maxBetAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"minBetAmount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"numUsers","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"startIndex","type":"uint256"},{"internalType":"uint256","name":"endIndex","type":"uint256"}],"name":"paginateAllUsers","outputs":[{"internalType":"address[]","name":"","type":"address[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"expManager_","type":"address"}],"name":"setExpManager","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"maxBetAmount_","type":"uint256"}],"name":"setMaxBetAmount","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"minBetAmount_","type":"uint256"}],"name":"setMinBetAmount","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalWagered","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"uint256","name":"GAME_ID","type":"uint256"}],"name":"wagered","outputs":[],"stateMutability":"nonpayable","type":"function"}]
// --- Constants ---
const POLLING_INTERVAL = 25000; // 25 seconds
const MIN_BALANCE = BigInt("100");

const MILESTONES = [
    // level 1
    { minWagered: 100,   bonusAmount: BigInt("20000") },
    // level 2
    { minWagered: 1000,  bonusAmount: BigInt("1000") },
    // level 3
    { minWagered: 10000, bonusAmount: BigInt("15000") },
    { minWagered: 50000, bonusAmount: BigInt("80000") },
    { minWagered: 100000, bonusAmount: BigInt("180000") },
    { minWagered: 250000, bonusAmount: BigInt("475000") },
    { minWagered: 500000, bonusAmount: BigInt("1000000") },
    { minWagered: 1000000, bonusAmount: BigInt("2250000") },
  ];
  
  const MAX_LEVEL = MILESTONES.length;

const getGPFromScore = (score) => {
    if (score <= 100) {
        return BigInt("20000");
    } else if (score <= 200) {
        return BigInt("30000");
    } else if (score <= 300) {
        return BigInt("40000");
    } else if (score <= 400) {
        return BigInt("50000");
    } else if (score <= 500) {
        return BigInt("60000");
    } else if (score <= 750) {
        return BigInt("100000");
    } else if (score <= 1000) {
        return BigInt("150000");
    } else if (score <= 1500) {
        return BigInt("250000");
    } else if (score <= 2000) {
        return BigInt("500000");
    } else {
        return BigInt("1000000");
    }
}

// --- In-Memory Retry Queue ---
// A Set to store user addresses for whom the on-chain tx succeeded but DB update failed.
const dbUpdateRetryQueue = new Map();

// --- Validation ---
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APECHAIN_RPC_URL || !PRIVATE_KEY || !EXP_MANAGER_CONTRACT_ADDRESS || !USER_INFO_CONTRACT_ADDRESS) {
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

    const userInfoContract = new ethers.Contract(USER_INFO_CONTRACT_ADDRESS, USER_INFO_ABI, wallet);
    console.log(`📄 User Info Contract loaded at address: ${USER_INFO_CONTRACT_ADDRESS}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract, userInfoContract);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} contract - The ethers contract instance.
 */
async function pollDatabaseAndProcessUsers(contract, userInfoContract) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for eligible users...`);

    try {
        // 1. First, try to process any users in the DB update retry queue.
        if (dbUpdateRetryQueue.size > 0) {
            console.log(`🔁 Retrying database updates for ${dbUpdateRetryQueue.size} user(s)...`);
            for (const [userAddress, targetLevel] of dbUpdateRetryQueue.entries()) {
              const { error: updateError } = await supabase
                .from('users')
                .update({
                  verification_bonus_level: targetLevel,
                  received_verification_bonus: targetLevel > 0 // optional, for backwards compat
                })
                .eq('user_address', userAddress);
          
              if (updateError) {
                console.error(`🚨 DB update retry failed for ${userAddress}:`, updateError.message);
              } else {
                console.log(`🎉 Successfully updated bonus level=${targetLevel} for ${userAddress} on retry.`);
                dbUpdateRetryQueue.delete(userAddress);
              }
            }
          }

        // 2. Find new users who are eligible.
        const { data: users, error: selectError } = await supabase
        .from('users')
        .select('user_address, x_handle, verification_bonus_level, x_score')
        .eq('x_verified', true)
        .lt('verification_bonus_level', MAX_LEVEL);

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

                const currentLevel = user.verification_bonus_level ?? 0;

                // Optional: sanity check on EXP balance
                console.log(`   - Checking EXP balance for ${user.user_address}...`);
                const apeWageredRaw = await userInfoContract.balanceOf(user.user_address);
                const apeWagered = parseFloat(ethers.formatEther(apeWageredRaw));
                console.log(`   - apeWagered is: ${apeWagered.toString()}`);
                if (apeWagered < MIN_BALANCE) {
                    console.log(`   - ⏭️ Skipping user: EXP balance is not > ${MIN_BALANCE}.`);
                    continue;
                }

                // 2️⃣ Figure out which level they SHOULD be at
                let newLevel = 0;
                for (let i = 0; i < MILESTONES.length; i++) {
                    if (apeWagered >= MILESTONES[i].minWagered) {
                        newLevel = i + 1;
                    } else {
                        break; // milestones are ordered by minWagered
                    }
                }

                if (newLevel <= currentLevel) {
                    console.log(
                      `   - No new milestones (currentLevel=${currentLevel}, newLevel=${newLevel}).`
                    );
                    continue;
                }

                console.log(`   - User qualifies for new levels: ${currentLevel + 1} → ${newLevel}`);
                
                // We only ever grant ONE level per run: the very next level.
                const targetLevel = currentLevel + 1;

                // Double-check they actually qualify for this targetLevel based on spend
                if (newLevel < targetLevel) {
                    console.log(
                        `   - User does not yet qualify for next level (targetLevel=${targetLevel}, newLevel=${newLevel}).`
                    );
                    continue;
                }

                const milestone = MILESTONES[targetLevel - 1];
                const milestoneBonusAmount = ( targetLevel - 1 ) === 0 ? getGPFromScore(user.x_score) : milestone.bonusAmount;
                console.log(
                `   - Granting level ${targetLevel} bonus: ${milestoneBonusAmount.toString()} EXP`
                );

                // Single on-chain tx for this milestone only
                const txOk = await executeBonusTransaction(
                contract,
                user.user_address,
                milestoneBonusAmount
                );

                if (!txOk) {
                    console.warn(
                        `   - Skipping DB update for ${user.user_address} because tx for level ${targetLevel} failed.`
                    );
                    continue;
                }

                // On-chain tx succeeded; now update DB to reflect the new level
                const { error: updateError } = await supabase
                .from('users')
                .update({
                    verification_bonus_level: targetLevel,
                    received_verification_bonus: targetLevel > 0, // optional/back-compat
                })
                .eq('user_address', user.user_address);

                if (updateError) {
                console.error(
                    `🚨 CRITICAL: DB update failed for ${user.user_address} after successful level ${targetLevel} tx. Adding to retry queue.`
                );
                // Store the level we *already granted on-chain* so we can safely retry the DB update only
                dbUpdateRetryQueue.set(user.user_address, targetLevel);
                } else {
                console.log(
                    `🎉 Successfully granted level ${targetLevel} bonus and updated DB for ${user.user_address}.`
                );
                }
            }
        }

    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollDatabaseAndProcessUsers(contract, userInfoContract), POLLING_INTERVAL);
}

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @param {string} userAddress The address of the user to receive the bonus.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeBonusTransaction(contract, userAddress, amount) {
    try {
        console.log(`   - Attempting to grant ${amount} EXP to ${userAddress}...`);

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        // Estimate gas
        const gasEstimate = await contract.grantBonusEXP.estimateGas(userAddress, amount);
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer
        console.log(`   - Estimated gas: ${gasEstimate}, Gas limit with buffer: ${gasLimitWithBuffer}`);

        // Send the transaction
        const tx = await contract.grantBonusEXP(userAddress, amount, {
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