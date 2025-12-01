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
} = process.env;

const USER_INFO_CONTRACT_ADDRESS = "0x6EA76F01Aa615112AB7de1409EFBD80a13BfCC84"

// The ABI only needs the balanceOf function for this script
const USER_INFO_ABI = [
    {
        "inputs": [{"internalType":"address","name":"user","type":"address"}],
        "name":"balanceOf",
        "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
        "stateMutability":"view",
        "type":"function"
    }
];

// --- Initialization ---
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APECHAIN_RPC_URL || !USER_INFO_CONTRACT_ADDRESS) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Helper function to check if the user's timestamp is stale (more than 6 hours old)
function isTimestampStale(timestamp) {
    if (!timestamp) return true; // Treat null/empty as stale (needs checking)

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const lastUpdate = new Date(timestamp).getTime();
    const now = Date.now();
    
    // Check if the difference between now and last update is greater than 6 hours
    return (now - lastUpdate) > SIX_HOURS_MS;
}

/**
 * Main function to identify and clear inactive users.
 */
async function clearInactiveUsers() {
    console.log("🚀 Starting Inactive User Cleanup Script...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const userInfoContract = new ethers.Contract(
        USER_INFO_CONTRACT_ADDRESS,
        USER_INFO_ABI,
        provider
    );
    console.log(`📄 User Info Contract loaded at address: ${USER_INFO_CONTRACT_ADDRESS}`);

    // --- Pagination Setup ---
    const BATCH_SIZE = 1000;
    let from = 0;
    let hasMoreUsers = true;
    let usersUpdatedCount = 0;
    let totalUsersChecked = 0;

    console.log("\n-------------------------------------");

    try {
        while (hasMoreUsers) {
            const to = from + BATCH_SIZE - 1;
            console.log(`\n🔍 Fetching users range: ${from} to ${to}...`);

            // 1. Fetch a batch of ALL verified users
            const { data: users, error: selectError } = await supabase
                .from('users')
                // Now fetching the timestamp to check it in the loop
                .select('user_address, x_handle, last_updated_x_timestamp') 
                .eq('x_verified', true)
                .range(from, to) 
                .order('user_address', { ascending: true }); 

            if (selectError) {
                throw new Error(`Error fetching users from Supabase: ${selectError.message}`);
            }

            if (!users || users.length === 0) {
                hasMoreUsers = false;
                console.log("✅ Reached the end of the user list.");
                break;
            }

            if (users.length < BATCH_SIZE) {
                hasMoreUsers = false;
            }

            console.log(`✨ Found ${users.length} verified users in this batch.`);

            // 2. Loop through each user in the batch and apply checks
            for (const user of users) {
                totalUsersChecked++;
                const userAddress = user.user_address;
                const lastUpdatedTimestamp = user.last_updated_x_timestamp;
                
                // --- THROTTLING CHECK ---
                if (!isTimestampStale(lastUpdatedTimestamp)) {
                    console.log(`   - ⏭️ Skipping ${user.x_handle}: Last checked < 6 hours ago.`);
                    continue;
                }
                
                try {
                    // Check apeWagered (balanceOf) on the blockchain
                    const apeWageredRaw = await userInfoContract.balanceOf(userAddress);
                    const apeWagered = ethers.formatUnits(apeWageredRaw, 18); // Assuming 18 decimals

                    if (parseFloat(apeWagered) === 0) {
                        // **ACTION: CLEAR INACTIVE USER**
                        console.log(`   - 🚨 Inactive User Found: ${user.x_handle} (${userAddress}) has 0 wagered.`);

                        // 3. Update the database to clear verification and reset timestamp
                        const { error: updateError } = await supabase
                            .from('users')
                            .update({
                                x_verified: false,
                                x_score: null,
                                verification_bonus_level: 0,
                                received_verification_bonus: false,
                                last_updated_x_timestamp: new Date().toISOString()
                            })
                            .eq('user_address', userAddress);

                        if (updateError) {
                            console.error(`   - ❌ DB Update Failed for ${userAddress}:`, updateError.message);
                        } else {
                            usersUpdatedCount++;
                            console.log(`   - ✅ Successfully cleared verification/score for ${user.x_handle}.`);
                        }
                    } else {
                        console.log(`   - 🟢 User ${user.x_handle} (${userAddress}) has ${apeWagered} wagered.`);
                    }
                } catch (rpcError) {
                    console.error(`   - ⚠️ RPC Call Failed for ${userAddress}:`, rpcError.message);
                }
            }

            // Move the offset for the next batch
            from += BATCH_SIZE;
        }

    } catch (error) {
        console.error("A critical error occurred during the cleanup process:", error);
    }

    console.log("\n-------------------------------------");
    console.log(`🏁 Cleanup Complete!`);
    console.log(`Total users checked: ${totalUsersChecked}`);
    console.log(`Total inactive users cleared (DB Updated): **${usersUpdatedCount}**`);
    console.log("-------------------------------------");
}

// --- Start the Script ---
clearInactiveUsers().catch(error => {
    console.error("A critical error occurred:", error);
    process.exit(1);
});