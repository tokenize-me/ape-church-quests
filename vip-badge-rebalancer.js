const { ethers } = require('ethers');
require('dotenv').config();

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    PRIVATE_KEY,
} = process.env;

const VIP_BADGE_CONTRACT = "0x07Ca4fdc27151F040e15c2e6E89fa09898eb287f";

const SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmg2x3lrvy37d01vq4bsnbtig/subgraphs/ape-church-newgp-subgraph/1.0.0/gn";

const VIP_BADGE_ABI = [
    "function getVIPBadgeOwners() external view returns (address[] memory)",
    "function tokenOfOwnerByIndex(address owner_, uint256 index) external view returns (uint256)",
    "function transferFrom(address from, address to, uint256 tokenId) external",
];

const LEADERBOARD_QUERY = `
    query GetExpLeaderboard($first: Int, $skip: Int) {
        users(orderBy: totalEXP, orderDirection: desc, first: $first, skip: $skip) {
            id
            totalEXP
        }
    }
`;

// --- Constants ---
const POLLING_INTERVAL = 300_000; // 5 minutes
const TOP_N = 10;
const SUBGRAPH_FETCH_N = 15; // over-fetch so ignored addresses don't starve the top 10
const IGNORED_ADDRESSES = new Set([
    "0x4671858639a5a80ce04aab003646791ee167b854",
].map((a) => a.toLowerCase()));

// --- Validation ---
if (!APECHAIN_RPC_URL || !PRIVATE_KEY) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

async function main() {
    console.log("🚀 Starting VIP Badge Rebalancer Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Allocation manager wallet loaded: ${wallet.address}`);

    const vipBadge = new ethers.Contract(VIP_BADGE_CONTRACT, VIP_BADGE_ABI, wallet);
    console.log(`📄 VIP Badge contract loaded at address: ${VIP_BADGE_CONTRACT}`);

    console.log(`🔍 Starting polling every ${POLLING_INTERVAL / 1000} seconds...`);
    await pollAndRebalance(vipBadge);
}

async function pollAndRebalance(vipBadge) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Running VIP badge rebalance check...`);

    try {
        const [rawTopUsers, currentOwners] = await Promise.all([
            fetchTopUsersFromSubgraph(SUBGRAPH_FETCH_N),
            vipBadge.getVIPBadgeOwners(),
        ]);

        const filteredTopUsers = (rawTopUsers || [])
            .map((a) => a.toLowerCase())
            .filter((a) => !IGNORED_ADDRESSES.has(a));
        const topUsers = filteredTopUsers.slice(0, TOP_N);

        if (topUsers.length < TOP_N) {
            console.warn(`⚠️  Subgraph returned ${rawTopUsers ? rawTopUsers.length : 0} users (${filteredTopUsers.length} after ignore-list), expected ${TOP_N}. Skipping this cycle.`);
            return;
        }

        if (!currentOwners || currentOwners.length < TOP_N) {
            console.warn(`⚠️  getVIPBadgeOwners returned ${currentOwners ? currentOwners.length : 0} owners, expected ${TOP_N}. Skipping this cycle.`);
            return;
        }

        const topSet = new Set(topUsers);
        const currentSet = new Set(currentOwners.map((a) => a.toLowerCase()));

        const dropouts = [...currentSet].filter((a) => !topSet.has(a));
        const newcomers = [...topSet].filter((a) => !currentSet.has(a));

        if (dropouts.length === 0 && newcomers.length === 0) {
            console.log("✅ VIP badge owners already match leaderboard. Nothing to do.");
            return;
        }

        if (dropouts.length !== newcomers.length) {
            console.warn(`⚠️  Mismatch: ${dropouts.length} dropouts vs ${newcomers.length} newcomers. Skipping this cycle.`);
            console.warn(`   - Dropouts: ${JSON.stringify(dropouts)}`);
            console.warn(`   - Newcomers: ${JSON.stringify(newcomers)}`);
            return;
        }

        console.log(`🔁 Rebalancing ${dropouts.length} badge(s):`);
        for (let i = 0; i < dropouts.length; i++) {
            const from = dropouts[i];
            const to = newcomers[i];
            console.log(`   - [${i + 1}/${dropouts.length}] ${from} -> ${to}`);
            const ok = await transferBadge(vipBadge, from, to);
            if (!ok) {
                console.warn(`   - ❌ Failed to transfer badge ${from} -> ${to}. Will retry next cycle.`);
                return;
            }
        }

        console.log("🎉 Rebalance complete for this cycle.");
    } catch (error) {
        console.error("❌ Unexpected error during rebalance cycle:", error);
    } finally {
        setTimeout(() => {
            pollAndRebalance(vipBadge).catch((error) => {
                console.error("❌ Poll loop crashed:", error);
            });
        }, POLLING_INTERVAL);
    }
}

async function fetchTopUsersFromSubgraph(first) {
    const response = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            query: LEADERBOARD_QUERY,
            variables: { first, skip: 0 },
        }),
    });

    if (!response.ok) {
        throw new Error(`Subgraph HTTP ${response.status}: ${await response.text()}`);
    }

    const json = await response.json();
    if (json.errors) {
        throw new Error(`Subgraph returned errors: ${JSON.stringify(json.errors)}`);
    }

    const users = json?.data?.users;
    if (!Array.isArray(users)) {
        throw new Error(`Subgraph returned unexpected payload: ${JSON.stringify(json)}`);
    }

    return users.map((u) => u.id);
}

async function transferBadge(vipBadge, from, to) {
    try {
        const tokenId = await vipBadge.tokenOfOwnerByIndex(from, 0);
        console.log(`     - tokenId held by ${from}: ${tokenId}`);

        const feeData = await vipBadge.runner.provider.getFeeData();
        const maxPriorityFeePerGas =
            (feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei")) + ethers.parseUnits("2", "gwei");
        const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei");

        const gasEstimate = await vipBadge.transferFrom.estimateGas(from, to, tokenId);
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100);
        console.log(`     - Estimated gas: ${gasEstimate}, with buffer: ${gasLimitWithBuffer}`);

        const tx = await vipBadge.transferFrom(from, to, tokenId, {
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas,
            maxFeePerGas,
        });

        const receipt = await tx.wait();
        console.log(`     - ✅ Transfer mined in block ${receipt.blockNumber}. Tx: ${receipt.hash}`);
        return true;
    } catch (error) {
        if (error.code === "INSUFFICIENT_FUNDS") {
            console.error("     - ❌ Transfer failed: insufficient funds for gas.");
            process.exit(1);
        }

        console.error("     - ❌ Transfer transaction failed:", error.shortMessage || error.message || error);
        return false;
    }
}

// --- Start the Bot ---
main().catch((error) => {
    console.error("A critical error occurred in main():", error);
    process.exit(1);
});
