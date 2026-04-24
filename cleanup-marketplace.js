const { ethers } = require('ethers');
require('dotenv').config();

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    PRIVATE_KEY,
} = process.env;

const MARKETPLACE_CONTRACT = "0x6af679E13CAaF36F088A540e86eD2B18a4dE11aF";

const CONTRACT_ABI = [
    "function fetchFirstInvalidListingBatch(address collection, uint256 start, uint256 end) external view returns (uint256)",
    "function getListedTokenIdsLength(address collection) external view returns (uint256)",
    "function cleanupListings(address collection, uint256[] calldata tokenIds) external",
];

const COLLECTIONS = [
    "0x073356F1aec3578B06efB6c45b9CD071e7D7C33d",
    "0x20BB8f6fe56e53fd4EB0cC628d761DDF7037EF30",
    "0x97c0586474238Be970CC2D8f7536Bc63b5bBca40",
    "0x5341A9aDbe746Ad90332C215f7f8A074d57Ca145",
    "0x81C9ce55E8214Fd0f5181FD3D38f52fD8c33Ec38",
    "0xe467Ede8C1c73770E7a5775c5375194A64dff444",
    "0x791Ae24887009CE39cf48e05639b629D9073C85f",
    "0xBA8C956575A6F5f66feC2E14aB8AA1D7785Ac7A3",
    "0xa9B992BEE3A12ef6381c7cf0672c0Fc158a39bb7"
]

// --- Constants ---
const POLLING_INTERVAL = 60_000; // 1 minute
const BATCH_SIZE = 500;

// --- Validation ---
if (!APECHAIN_RPC_URL || !PRIVATE_KEY) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

async function main() {
    console.log("🚀 Starting marketplace cleanup bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const contract = new ethers.Contract(MARKETPLACE_CONTRACT, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${MARKETPLACE_CONTRACT}`);

    console.log(`🔍 Starting polling every ${POLLING_INTERVAL / 1000} seconds...`);
    await pollCollections(contract);
}

async function pollCollections(contract) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Running marketplace cleanup scan...`);

    try {
        for (const collection of COLLECTIONS) {
            await scanCollection(contract, collection);
        }
    } catch (error) {
        console.error("❌ Unexpected error during polling cycle:", error);
    } finally {
        setTimeout(() => {
            pollCollections(contract).catch((error) => {
                console.error("❌ Poll loop crashed:", error);
            });
        }, POLLING_INTERVAL);
    }
}

async function scanCollection(contract, collection) {
    const totalListingsBigInt = await contract.getListedTokenIdsLength(collection);
    const totalListings = Number(totalListingsBigInt.toString());
    console.log(`\n📚 Collection ${collection} has ${totalListings} listings`);

    if (totalListings === 0) {
        console.log("   - Skipping: no listings.");
        return;
    }

    for (let start = 0; start < totalListings; start += BATCH_SIZE) {
        const end = start + BATCH_SIZE > totalListings ? totalListings : start + BATCH_SIZE;
        const invalidTokenId = await contract.fetchFirstInvalidListingBatch(collection, BigInt(start), BigInt(end));

        if (invalidTokenId !== ethers.MaxUint256) {
            console.log(`   - Found invalid listing tokenId=${invalidTokenId} in range [${start}, ${end})`);
            const cleaned = await cleanupInvalidListing(contract, collection, invalidTokenId);
            if (!cleaned) {
                console.warn(`   - Failed to clean tokenId=${invalidTokenId} for ${collection}`);
            }

            // Stop after first cleanup. List indexes may shift; next poll will rescan safely.
            return;
        }
    }

    console.log("   - No invalid listings found.");
}

async function cleanupInvalidListing(contract, collection, tokenId) {
    try {
        const feeData = await contract.runner.provider.getFeeData();
        const maxPriorityFeePerGas =
            (feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei")) + ethers.parseUnits("2", "gwei");
        const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits("20", "gwei");

        const gasEstimate = await contract.cleanupListings.estimateGas(collection, [tokenId]);
        const gasLimitWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100);

        console.log(`   - Submitting cleanup tx for tokenId=${tokenId} and collection=${collection}`);
        const tx = await contract.cleanupListings(collection, [tokenId], {
            gasLimit: gasLimitWithBuffer,
            maxPriorityFeePerGas,
            maxFeePerGas,
        });

        const receipt = await tx.wait();
        console.log(`   - ✅ Cleanup mined in block ${receipt.blockNumber}. Tx: ${receipt.hash}`);
        return true;
    } catch (error) {
        if (error.code === "INSUFFICIENT_FUNDS") {
            console.error("   - ❌ Cleanup failed: insufficient funds for gas.");
            process.exit(1);
        }

        console.error("   - ❌ Cleanup transaction failed:", error.shortMessage || error.message || error);
        return false;
    }
}

// --- Start the Bot ---
main().catch((error) => {
    console.error("A critical error occurred in main():", error);
    process.exit(1);
});