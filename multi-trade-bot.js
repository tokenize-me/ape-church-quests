const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { encodeAbiParameters } = require('viem');
const { hashMessage } = require('viem');

// --- Configuration ---
const {
    APECHAIN_RPC_URL,
    BOT_PRIVATE_KEYS_ARRAY,
} = process.env;

// Parse BOT_PRIVATE_KEYS_ARRAY from comma-separated string to array
// Example .env format: BOT_PRIVATE_KEYS_ARRAY=key1,key2,key3
const BOT_PRIVATE_KEYS = BOT_PRIVATE_KEYS_ARRAY
    ? BOT_PRIVATE_KEYS_ARRAY.split(',').map(key => key.trim()).filter(key => key.length > 0)
    : [];

const ROULETTE = "0x1f48A104C1808eb4107f3999999D36aeafEC56d5";
const APESTRONG = "0x0717330c1a9e269a0e034aBB101c8d32Ac0e9600";
const GIMBO_SMASH = "0x17e219844F25F3FED6E422DdaFfD2E6557eBCEd3";
const BEAR_DICE = "0x6a48A513A46955D8622C809Fce876d2f11142003";

// Your Contract ABI - updated with the correct functions
const CONTRACT_ABI = ["function play(address player, bytes calldata gameData) external payable"];
// --- Constants ---
const POLLING_INTERVAL = 10_000; // 20 seconds

const MINIMUM_BALANCE_UNFORMATTED = "51";
const MINIMUM_BALANCE = ethers.parseUnits(MINIMUM_BALANCE_UNFORMATTED, "ether");

const MAX_BET = 150;
const MAX_BET_RISKY = 100;
const MIN_BET = 30;

const MAX_BET_PERCENTAGE = 0.25;
const MAX_BET_PERCENTAGE_RISKY = 0.15;

const RISKY_GAME_PERCENTAGE = 0.1;

// --- Validation ---
if (!APECHAIN_RPC_URL || !BOT_PRIVATE_KEYS_ARRAY || BOT_PRIVATE_KEYS.length === 0) {
    console.error("❌ Missing required environment variables. Please check your .env file.");
    console.error("   BOT_PRIVATE_KEYS_ARRAY should be comma-separated: key1,key2,key3");
    process.exit(1);
}
/**
 * The main function that initializes clients and starts the bot.
 */
async function main() {
    console.log("🚀 Starting Supabase Verification Bonus Bot...");

    const provider = new ethers.JsonRpcProvider(APECHAIN_RPC_URL);
    console.log("✅ Connected to Ape Chain RPC.");

    const wallets = BOT_PRIVATE_KEYS.map(privateKey => new ethers.Wallet(privateKey, provider));

    const walletGames = wallets.map(wallet => {
        return {
            wallet: wallet,
            games: [
                new ethers.Contract(ROULETTE, CONTRACT_ABI, wallet),
                new ethers.Contract(APESTRONG, CONTRACT_ABI, wallet),
                new ethers.Contract(GIMBO_SMASH, CONTRACT_ABI, wallet),
                new ethers.Contract(BEAR_DICE, CONTRACT_ABI, wallet),
            ],
            gameNames: [
                "Roulette",
                "ApeStrong",
                "GimboSmash",
                "BearDice",
            ]
        }
    });

    console.log(`🔍 Starting database polling every ${POLLING_INTERVAL / 1000} seconds...`);
    pollDatabaseAndProcessUsers(walletGames);
}

/**
 * Polls the database for eligible users and processes them.
 * @param {ethers.Contract} games - A list of ethers contract instances.
 */
async function pollDatabaseAndProcessUsers(walletGames) {
    console.log("\n-------------------------------------");
    console.log(`[${new Date().toISOString()}] Polling for Ape balance...`);

    const walletIndex = Math.floor(Math.random() * walletGames.length);
    const walletToPlay = walletGames[walletIndex];
    const wallet = walletToPlay.wallet;
    const gameNames = walletToPlay.gameNames;
    const games = walletToPlay.games;

    const gameIndex = Math.floor(Math.random() * games.length);
    const gameContract = games[gameIndex];
    const gameName = gameNames[gameIndex];

    const isRiskyGame = Math.random() < RISKY_GAME_PERCENTAGE;
    if (isRiskyGame) {
        console.log(`🔍 Playing risky game for wallet ${walletIndex}`);
    } else {
        console.log(`🔍 Playing safe game for wallet ${walletIndex}`);
    }

    try {
        const apeBalance = await gameContract.runner.provider.getBalance(wallet.address);
        const formattedBalance = parseFloat(ethers.formatUnits(apeBalance, "ether"));
        console.log(`🔍 Ape balance: ${formattedBalance}`);
        if (apeBalance < MINIMUM_BALANCE) {
            console.log(`❌ Ape balance is less than ${MINIMUM_BALANCE_UNFORMATTED} APE`);
            return;
        }

        const MAX_BET_PERC = isRiskyGame ? MAX_BET_PERCENTAGE_RISKY : MAX_BET_PERCENTAGE;
        const MAX_BET_TO_USE = isRiskyGame ? MAX_BET_RISKY : MAX_BET;

        // determine an amount to play with, below 33% of the balance
        let amountToPlay = Math.floor(formattedBalance * Math.random() * MAX_BET_PERC);

        if (amountToPlay < MIN_BET) {
            amountToPlay = MIN_BET;
        } else if (amountToPlay > MAX_BET_TO_USE) {
            amountToPlay = MAX_BET_TO_USE;
        }

        if (amountToPlay > formattedBalance) {
            console.log("Amount to play is greater than balance, reducing amount to play to balance");
            amountToPlay = formattedBalance - 1;
        }

        console.log(`🔍 Playing ${gameName}...`);
        console.log(`🔍 Amount to play: ${amountToPlay}`);

        let txOk = false;
        if (gameName === "Roulette") {
            txOk = await executeRouletteTransaction(gameContract, wallet, amountToPlay, isRiskyGame);
        } else if (gameName === "ApeStrong") {
            txOk = await executeApeStrongTransaction(gameContract, wallet, amountToPlay, isRiskyGame);
        } else if (gameName === "GimboSmash") {
            txOk = await executeGimboSmashTransaction(gameContract, wallet, amountToPlay, isRiskyGame);
        } else if (gameName === "BearDice") {
            txOk = await executeBearDiceTransaction(gameContract, wallet, amountToPlay, isRiskyGame);
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
    setTimeout(() => pollDatabaseAndProcessUsers(walletGames), POLLING_INTERVAL);
}

/**
 * Executes the 'grantBonusEXP' smart contract function.
 * @param {ethers.Contract} contract The ethers contract instance.
 * @returns {Promise<boolean>} True if the transaction was successful, otherwise false.
 */
async function executeRouletteTransaction(contract, wallet, amountToPlay, isRiskyGame) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("1", "gwei");

        const vrfFee = BigInt("73211589000000001");

        const BET_AMOUNT_PER = Math.floor(amountToPlay / 2).toString();
        
        let BET_NUMBERS;
        let BET_AMOUNTS;

        if (isRiskyGame) {
            BET_NUMBERS = [49];
            BET_AMOUNTS = [ethers.parseUnits(Math.floor(amountToPlay).toString(), "ether")];
        } else {
            BET_NUMBERS = [49, 50];
            BET_AMOUNTS = [ethers.parseUnits(BET_AMOUNT_PER, "ether"), ethers.parseUnits(BET_AMOUNT_PER, "ether")];
        }

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
async function executeApeStrongTransaction(contract, wallet, amountToPlay, isRiskyGame) {
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

        const target = isRiskyGame ? 60 : 95;

        const encodedData = encodeAbiParameters(
            [
              { name: "edgeFlipRange", type: "uint8" },
              { name: "gameId", type: "uint" },
              { name: "ref", type: "address" },
              { name: "randomWord", type: "bytes32" },
            ],
            [
              target,
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
async function executeGimboSmashTransaction(contract, wallet, amountToPlay, isRiskyGame) {
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

        const numWinIntervals = 1;
        const winStarts = isRiskyGame ? [5, 0] : [40, 0];
        const winEnds = [99, 0];

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
              numWinIntervals,
              winStarts,
              winEnds,
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
async function executeBearDiceTransaction(contract, wallet, amountToPlay, isRiskyGame) {
    try {

        const feeData = await contract.runner.provider.getFeeData();
        console.log("   - Current Fee Data:", {
            maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, "gwei"),
            maxPriorityFeePerGas: ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei"),
        });

        const priorityFee = feeData.maxPriorityFeePerGas + ethers.parseUnits("1", "gwei");

        const vrfFee = isRiskyGame ? BigInt("117138542400000001") : BigInt("73211589000000001");

        const BET_AMOUNT = ethers.parseUnits(amountToPlay.toString(), "ether");

        const totalValue = BET_AMOUNT + vrfFee;
        
        // generate random uint256 for the gameId, needs to be bigint
        // hash something to get a random bytes32
        const randomSeed = Math.random().toString(36).substring(2, 15);
        const randomBytes32 = hashMessage(randomSeed);
        const gameId = BigInt(randomBytes32.slice(0, 16));
        const userRandomWord = hashMessage("I like big butts and I cannot lie!!");

        const difficulty = 0;
        const numRuns = isRiskyGame ? 3 : 1;

        const encodedData = encodeAbiParameters(
            [
              { name: "difficulty", type: "uint8" },
              { name: "numRuns", type: "uint8" },
              { name: "gameId", type: "uint" },
              { name: "ref", type: "address" },
              { name: "randomWord", type: "bytes32" },
            ],
            [
              difficulty,
              numRuns,
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