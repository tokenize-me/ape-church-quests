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

const EXP_MANAGER_CONTRACT_ADDRESS = "0x0382338F3876237Ae89317A6a8207C432D430b93";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = [{"inputs":[{"internalType":"address","name":"userInfoTracker_","type":"address"},{"internalType":"address","name":"expBoostManager_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"inputs":[],"name":"EXP_PER_LEVEL","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"EXP_SCALE","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"WAGERED_PER_EXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"}],"name":"batchGetLevels","outputs":[{"internalType":"uint256[]","name":"levels","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"users","type":"address[]"},{"internalType":"uint256[]","name":"amounts","type":"uint256[]"}],"name":"batchGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canGrantBonusEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSetEXPScale","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"canSpendEXP","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"expBoostManager","outputs":[{"internalType":"contract IEXPBoostManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getCurrentEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevel","outputs":[{"internalType":"uint256","name":"level","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getLevelAndEXP","outputs":[{"internalType":"uint256","name":"level","type":"uint256"},{"internalType":"uint256","name":"exp","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"}],"name":"getTotalEXP","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"grantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"oldEXPManager","type":"address"}],"name":"initWagered","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"manager","outputs":[{"internalType":"contract IGovernanceManager","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canGrant","type":"bool"}],"name":"setCanGrantBonusEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"bool","name":"canSet","type":"bool"}],"name":"setCanSetEXPScale","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"destContract","type":"address"},{"internalType":"bool","name":"canSpend","type":"bool"}],"name":"setCanSpendEXP","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_expBoostManager","type":"address"}],"name":"setEXPBoostManager","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_EXP_SCALE","type":"uint256"}],"name":"setEXP_SCALE","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"_userInfoTracker","type":"address"}],"name":"setUserInfoTracker","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"spendEXP","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"userInfo","outputs":[{"internalType":"uint256","name":"totalEXP","type":"uint256"},{"internalType":"uint256","name":"currentEXP","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"userInfoTracker","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"user","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"wagered","outputs":[],"stateMutability":"nonpayable","type":"function"}];

// --- Constants ---
const POLLING_INTERVAL = 10000; // 10 seconds
// Per-user reward sanity cap. GP has 0 decimals so this is a raw token count.
const MAX_AMOUNT = BigInt(20000);
// When the signer's GP balance drops below this we emit a loud warning so
// operators know to top the wallet off before users start getting skipped.
const LOW_BALANCE_WARNING = BigInt(100000);

// --- In-Memory Retry Queue ---
// Stores (userAddress, questId) pairs whose on-chain transfer succeeded but
// whose Supabase row update failed. We retry these at the top of every cycle.
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
    console.log("🚀 Starting Supabase Verification Bonus Bot (Transfer Mode)...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(EXP_MANAGER_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${EXP_MANAGER_CONTRACT_ADDRESS}`);

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(contract, wallet);
}

/**
 * Polls the database for eligible users and pays their rewards by transferring
 * GP from the signer wallet (no longer minting).
 * @param {ethers.Contract} contract - The ethers contract instance bound to the signer.
 * @param {ethers.Wallet} wallet - The signer wallet, used to read its own GP balance.
 */
async function pollDatabaseAndProcessUsers(contract, wallet) {
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

        // 2. Read signer's current GP balance. We track this locally as we
        // transfer so we can skip users we can't afford without a balanceOf
        // call per user.
        let signerGPBalance;
        try {
            signerGPBalance = await contract.balanceOf(wallet.address);
        } catch (err) {
            console.error(`🚨 Failed to read signer GP balance: ${err.message}. Skipping cycle.`);
            scheduleNextPoll(contract, wallet);
            return;
        }

        console.log(`💰 Signer GP balance: ${signerGPBalance.toString()} GP`);

        if (signerGPBalance === BigInt(0)) {
            console.warn(
                `⚠️  Signer ${wallet.address} has 0 GP. Top off the wallet to resume payouts. ` +
                `Eligible users will be retried automatically next cycle.`
            );
            scheduleNextPoll(contract, wallet);
            return;
        }

        if (signerGPBalance < LOW_BALANCE_WARNING) {
            console.warn(
                `⚠️  Signer GP balance (${signerGPBalance}) is below low-balance threshold ` +
                `(${LOW_BALANCE_WARNING}). Top off ${wallet.address} soon to avoid skipping rewards.`
            );
        }

        // 3. Fetch active quests + eligible users.
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
            scheduleNextPoll(contract, wallet);
            return;
        }

        console.log(`✨ Found ${newUsers.length} total new user(s) to process.`);

        // 4. Process users one-by-one, tracking the local running balance.
        // Continuing past insufficient-balance entries lets smaller rewards
        // still get paid out of what's left.
        let remainingBalance = signerGPBalance;
        let granted = 0;
        let skippedInsufficient = 0;
        let skippedZeroReward = 0;
        let skippedTooHigh = 0;
        let txFailed = 0;

        for (const user of newUsers) {
            const rewardRaw = quests.find(quest => quest.id === user.quest_id)?.reward ?? 0;
            const reward = BigInt(rewardRaw);

            if (reward === BigInt(0)) {
                console.log(`   - ⏭️  Skipping ${user.user_address} (quest ${user.quest_id}): reward is 0.`);
                skippedZeroReward++;
                continue;
            }

            if (reward > MAX_AMOUNT) {
                console.warn(
                    `   - ⏭️  Skipping ${user.user_address} (quest ${user.quest_id}): ` +
                    `reward ${reward} exceeds MAX_AMOUNT ${MAX_AMOUNT}.`
                );
                skippedTooHigh++;
                continue;
            }

            if (reward > remainingBalance) {
                console.warn(
                    `   - ⏭️  Skipping ${user.user_address} (quest ${user.quest_id}): ` +
                    `reward ${reward} GP > remaining signer balance ${remainingBalance} GP. ` +
                    `Will retry next cycle.`
                );
                skippedInsufficient++;
                continue;
            }

            const txOk = await executeTransfer(contract, user.user_address, reward);

            if (!txOk) {
                txFailed++;
                continue;
            }

            // Tx succeeded — decrement local balance before any DB work.
            remainingBalance -= reward;
            granted++;

            const { error: updateError } = await supabase
                .from('user_x_interaction_quests')
                .update({ received_verification_bonus: true })
                .eq('user_address', user.user_address)
                .eq('quest_id', user.quest_id);

            if (updateError) {
                console.error(
                    `🚨 CRITICAL: DB update failed for ${user.user_address} (Quest ${user.quest_id}) ` +
                    `after successful transfer. Adding to retry queue.`
                );
                const queueKey = `${user.user_address}:${user.quest_id}`;
                dbUpdateRetryQueue.set(queueKey, {
                    userAddress: user.user_address,
                    questId: user.quest_id,
                });
            } else {
                console.log(
                    `🎉 Transferred ${reward} GP → ${user.user_address} (quest ${user.quest_id}).`
                );
            }
        }

        console.log(
            `📊 Cycle summary: granted=${granted}, txFailed=${txFailed}, ` +
            `skippedInsufficient=${skippedInsufficient}, skippedZeroReward=${skippedZeroReward}, ` +
            `skippedTooHigh=${skippedTooHigh}, remainingBalance=${remainingBalance} GP`
        );

    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    scheduleNextPoll(contract, wallet);
}

function scheduleNextPoll(contract, wallet) {
    setTimeout(() => pollDatabaseAndProcessUsers(contract, wallet), POLLING_INTERVAL);
}

/**
 * Executes a single ERC20 'transfer' from the signer to the recipient.
 * @param {ethers.Contract} contract The ethers contract instance bound to the signer.
 * @param {string} userAddress The recipient address.
 * @param {bigint} amount The raw GP amount to transfer (GP has 0 decimals).
 * @returns {Promise<boolean>} True if the transaction was mined successfully.
 */
async function executeTransfer(contract, userAddress, amount) {
    try {
        console.log(`   - Transferring ${amount} GP → ${userAddress}...`);

        const feeData = await contract.runner.provider.getFeeData();
        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("2", "gwei");

        let gasEstimate;
        try {
            gasEstimate = await contract.transfer.estimateGas(userAddress, amount);
        } catch (err) {
            // If estimateGas reverts (e.g. on-chain balance shortfall from a
            // race condition with another spender), bail out of this user
            // without burning gas.
            console.warn(
                `   - Gas estimation failed for ${userAddress}: ${err.shortMessage ?? err.message}. ` +
                `Skipping this transfer.`
            );
            return false;
        }

        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100); // 20% buffer

        const tx = await contract.transfer(userAddress, amount, {
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: feeData.maxFeePerGas,
        });

        console.log(`   - Tx sent: ${tx.hash}. Waiting...`);
        const receipt = await tx.wait();
        console.log(`   - 🎉 Tx mined in block ${receipt.blockNumber}.`);
        return true;

    } catch (error) {
        if (error.code === 'INSUFFICIENT_FUNDS') {
            // This is APE-for-gas insufficiency, not GP. Hard-exit so an
            // operator can refuel — same behavior as before.
            console.error("   - Transaction failed: signer has insufficient APE for gas.");
            process.exit(1);
        }
        if (error.code === 'CALL_EXCEPTION' || error.reason) {
            console.warn(
                `   - Transfer failed. Reason: ${error.reason ?? error.shortMessage ?? 'unknown'}`
            );
            return false;
        }
        console.error("   - An unexpected error occurred during transfer execution:", error);
        return false;
    }
}

// --- Start the Bot ---
main().catch(error => {
    console.error("A critical error occurred in the main function:", error);
    process.exit(1);
});