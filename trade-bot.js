const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { encodeAbiParameters } = require('viem');
const { hashMessage } = require('viem');

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    BOT_PRIVATE_KEY,
} = process.env;

const ROULETTE = "0x1f48A104C1808eb4107f3999999D36aeafEC56d5";
const APESTRONG = "0x0717330c1a9e269a0e034aBB101c8d32Ac0e9600";
const GIMBO_SMASH = "0x17e219844F25F3FED6E422DdaFfD2E6557eBCEd3";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = ["function play(address player, bytes calldata gameData) external payable"];
// --- Constants ---
const POLLING_INTERVAL = 300_000; // 5 minutes

const CHECK_AMOUNT_UNFORMATTED = "201";
const CHECK_AMOUNT = ethers.parseUnits(CHECK_AMOUNT_UNFORMATTED, "ether");

const MINIMUM_BALANCE_UNFORMATTED = "500";
const MINIMUM_BALANCE = ethers.parseUnits(MINIMUM_BALANCE_UNFORMATTED, "ether");

// --- Validation ---
if (!APECHAIN_RPC_URL || !BOT_PRIVATE_KEY) {
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

    const wallet = new ethers.Wallet(BOT_PRIVATE_KEY, provider);
    console.log(`👤 Wallet loaded: ${wallet.address}`);

    const rouletteContract = new ethers.Contract(ROULETTE, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${ROULETTE}`);

    const apestrongContract = new ethers.Contract(APESTRONG, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${APESTRONG}`);

    const gimboSmashContract = new ethers.Contract(GIMBO_SMASH, CONTRACT_ABI, wallet);
    console.log(`📄 Contract loaded at address: ${GIMBO_SMASH}`);

    const games = [
        {
            contract: rouletteContract,
            name: "Roulette",
        },
        {
            contract: apestrongContract,
            name: "ApeStrong"
        },
        {
            contract: gimboSmashContract,
            name: "GimboSmash"
        },
    ];

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(games, wallet);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} games - A list of ethers contract instances.
 */
async function pollDatabaseAndProcessUsers(games, wallet) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for Ape balance...`);

    const gameToPlay = games[Math.floor(Math.random() * games.length)];
    const gameContract = gameToPlay.contract;
    const gameName = gameToPlay.name;
    try {
        const apeBalance = await gameContract.runner.provider.getBalance(wallet.address);
        console.log(`🔍 Ape balance: ${apeBalance}`);
        if (apeBalance < MINIMUM_BALANCE) {
            console.log(`❌ Ape balance is less than ${MINIMUM_BALANCE_UNFORMATTED} APE`);
            return;
        }

        const formattedBalance = parseFloat(ethers.formatUnits(apeBalance, "ether"));
        const minBalance = Math.floor(formattedBalance * 0.05);

        // determine an amount to play with, between 5% and 20% of the balance
        let amountToPlay = Math.floor(formattedBalance * Math.random() * 0.2);
        if (amountToPlay < minBalance) {
            amountToPlay = minBalance;
        }

        console.log(`🔍 Playing ${gameName}...`);
        console.log(`🔍 Amount to play: ${amountToPlay}`);

        let txOk = false;
        if (gameName === "Roulette") {
            txOk = await executeRouletteTransaction(gameContract, wallet, amountToPlay);
        } else if (gameName === "ApeStrong") {
            txOk = await executeApeStrongTransaction(gameContract, wallet, amountToPlay);
        } else if (gameName === "GimboSmash") {
            txOk = await executeGimboSmashTransaction(gameContract, wallet, amountToPlay);
        } else {
            console.warn("❌ Unknown game");
            txOk = false;
        }

        if (!txOk) {
            console.warn("❌ Transaction failed");
        }
    } catch (error) {
        console.error("An unexpected error occurred during the polling cycle:", error);
    }

    // Schedule the next poll
    setTimeout(() => pollDatabaseAndProcessUsers(games, wallet), POLLING_INTERVAL);
}

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeRouletteTransaction(contract, wallet, amountToPlay) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("1", "gwei");

        const vrfFee = BigInt("73211589000000001");

        const BET_AMOUNT_PER = Math.floor(amountToPlay / 2).toString();

        const BET_NUMBERS = [49, 50];
        const BET_AMOUNTS = [ethers.parseUnits(BET_AMOUNT_PER, "ether"), ethers.parseUnits(BET_AMOUNT_PER, "ether")];

        const totalValue = BET_AMOUNTS.reduce((a, b) => a + b, BigInt(0)) + vrfFee;
        
        // generate random uint256 for the gameId, needs to be bigint
        // hash something to get a random bytes32
        const randomSeed = Math.random().toString(36).substring(2, 15);
        const randomBytes32 = hashMessage(randomSeed);
        const gameId = BigInt(randomBytes32.slice(0, 16));
        const userRandomWord = hashMessage("I like big butts and I cannot lie!!");

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
              "0x91cF4F24EF2234C6C3c51669D0F2fa46FA562227",
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

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeApeStrongTransaction(contract, wallet, amountToPlay) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("1", "gwei");

        const vrfFee = BigInt("73211589000000001");

        const BET_AMOUNT = ethers.parseUnits(amountToPlay.toString(), "ether");

        const totalValue = BET_AMOUNT + vrfFee;
        
        // generate random uint256 for the gameId, needs to be bigint
        // hash something to get a random bytes32
        const randomSeed = Math.random().toString(36).substring(2, 15);
        const randomBytes32 = hashMessage(randomSeed);
        const gameId = BigInt(randomBytes32.slice(0, 16));
        const userRandomWord = hashMessage("I like big butts and I cannot lie!!");


        const encodedData = encodeAbiParameters(
            [
              { name: "edgeFlipRange", type: "uint8" },
              { name: "gameId", type: "uint" },
              { name: "ref", type: "address" },
              { name: "randomWord", type: "bytes32" },
            ],
            [
              95,
              gameId,
              "0x91cF4F24EF2234C6C3c51669D0F2fa46FA562227",
              userRandomWord,
            ]
          );

        // Estimate gas
        const gasEstimate = await contract.play.estimateGas(wallet.address, encodedData, { value: totalValue });
        const gasLimitWithBuffer = (gasEstimate * BigInt(105)) / BigInt(100); // 5% buffer
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


/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeGimboSmashTransaction(contract, wallet, amountToPlay) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("1", "gwei");

        const vrfFee = BigInt("73211589000000001");

        const BET_AMOUNT = ethers.parseUnits(amountToPlay.toString(), "ether");

        const totalValue = BET_AMOUNT + vrfFee;
        
        // generate random uint256 for the gameId, needs to be bigint
        // hash something to get a random bytes32
        const randomSeed = Math.random().toString(36).substring(2, 15);
        const randomBytes32 = hashMessage(randomSeed);
        const gameId = BigInt(randomBytes32.slice(0, 16));
        const userRandomWord = hashMessage("I like big butts and I cannot lie!!");

        /**
         uint8 numWinIntervals,
            uint8[2] memory winStarts,
            uint8[2] memory winEnds,
            uint256 gameId,
            address ref,
            bytes32 userRandomWord
         */

        const encodedData = encodeAbiParameters(
            [
              { name: "numWinIntervals", type: "uint8" },
              { name: "winStarts", type: "uint8[2]" },
              { name: "winEnds", type: "uint8[2]" },
              { name: "gameId", type: "uint" },
              { name: "ref", type: "address" },
              { name: "randomWord", type: "bytes32" },
            ],
            [
              1,
              [5, 0],
              [99, 0],
              gameId,
              "0x91cF4F24EF2234C6C3c51669D0F2fa46FA562227",
              userRandomWord,
            ]
          );

        // Estimate gas
        const gasEstimate = await contract.play.estimateGas(wallet.address, encodedData, { value: totalValue });
        const gasLimitWithBuffer = (gasEstimate * BigInt(105)) / BigInt(100); // 5% buffer
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