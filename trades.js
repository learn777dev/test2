const { ethers } = require("ethers");
const fs = require("fs");

// Публичный RPC Arbitrum
const RPC_URL = "https://arb1.arbitrum.io/rpc";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

// Адрес пула Uniswap V3
const POOL_ADDRESS = "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443";

// ABI Uniswap V3 пула для получения информации о токенах и отслеживания событий Swap
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function tickSpacing() view returns (int24)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
];

// ERC-20 ABI для получения десятичных знаков токенов
const ERC20_ABI = [
  "function decimals() view returns (uint8)"
];

// Файл для сохранения сделок
const FILE_PATH = "swaps.json";

// Массив для хранения всех сделок
let allSwaps = [];

// Загружаем существующие сделки из файла, если файл существует
if (fs.existsSync(FILE_PATH)) {
  const fileData = fs.readFileSync(FILE_PATH);
  allSwaps = JSON.parse(fileData);
  console.log(`Загружено сделок из файла: ${allSwaps.length}`);
}

async function main() {
  try {
    // Подключаем контракт пула
    const poolContract = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

    // Получаем адреса токенов
    const token0Address = await poolContract.token0();
    const token1Address = await poolContract.token1();

    // Подключаем контракты токенов
    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    // Получаем количество десятичных знаков для каждого токена
    const token0Decimals = await token0Contract.decimals();
    const token1Decimals = await token1Contract.decimals();

    // Получаем значение tickSpacing для расчета ценовых границ тиков
    const tickSpacing = await poolContract.tickSpacing();

    console.log(`Token0 address: ${token0Address}, decimals: ${token0Decimals}`);
    console.log(`Token1 address: ${token1Address}, decimals: ${token1Decimals}`);
    console.log(`Tick spacing: ${tickSpacing}`);

    // Функция для получения текущего времени
    function getCurrentTime() {
      const now = new Date();
      return now.toLocaleString(); // Выводим время в формате "дата, время"
    }

    // Функция для вычисления цен токенов из sqrtPriceX96
    function calculatePrices(sqrtPriceX96, token0Decimals, token1Decimals) {
      const sqrtPrice = sqrtPriceX96 / 2 ** 96;

      // Цена токена1 относительно токена0
      const priceToken1InToken0 = (sqrtPrice ** 2) * 10 ** (token0Decimals - token1Decimals);
      
      // Цена токена0 относительно токена1
      const priceToken0InToken1 = (1 / (sqrtPrice ** 2)) * 10 ** (token1Decimals - token0Decimals);

      return { priceToken0InToken1, priceToken1InToken0 };
    }

    // Функция для расчета цены из значения тика
    function tickToPrice(tick, token0Decimals, token1Decimals) {
      // Вычисляем сырую цену из тика
      const priceRaw = 1.0001 ** tick;
      
      // Масштабируем цену с учётом десятичных знаков
      const priceToken0InToken1 = priceRaw * 10 ** (token1Decimals - token0Decimals);
      return priceToken0InToken1;
    }

    // Функция для отображения текущих диапазонов и соседних диапазонов тиков
    function displayTickRanges(tick, token0Decimals, token1Decimals, tickSpacing) {
      // Рассчитываем нижнюю и верхнюю границы текущего тика
      const lowerTick = Math.floor(tick / tickSpacing) * tickSpacing;
      const upperTick = lowerTick + tickSpacing;

      const lowerPrice = tickToPrice(lowerTick, token1Decimals, token0Decimals);
      const upperPrice = tickToPrice(upperTick, token1Decimals, token0Decimals);

      // Рассчитываем соседние диапазоны: тик ниже и тик выше
      const prevLowerTick = lowerTick - tickSpacing;
      const prevUpperTick = lowerTick;
      const nextLowerTick = upperTick;
      const nextUpperTick = upperTick + tickSpacing;

      const prevLowerPrice = tickToPrice(prevLowerTick, token1Decimals, token0Decimals);
      const prevUpperPrice = tickToPrice(prevUpperTick, token1Decimals, token0Decimals);
      const nextLowerPrice = tickToPrice(nextLowerTick, token1Decimals, token0Decimals);
      const nextUpperPrice = tickToPrice(nextUpperTick, token1Decimals, token0Decimals);

      // Отображение диапазонов
      console.log(`\n=== Диапазоны тиков ===`);
      console.log(`Текущий тик: ${tick}`);
      console.log(`Нижняя граница текущего тика: ${lowerPrice}`);
      console.log(`Верхняя граница текущего тика: ${upperPrice}`);

      console.log(`\n=== Соседний диапазон ниже текущего ===`);
      console.log(`Нижняя граница: ${prevLowerPrice}`);
      console.log(`Верхняя граница: ${prevUpperPrice}`);

      console.log(`\n=== Соседний диапазон выше текущего ===`);
      console.log(`Нижняя граница: ${nextLowerPrice}`);
      console.log(`Верхняя граница: ${nextUpperPrice}`);
    }

    // Подписка на событие Swap
    console.log('Подписываемся на события Swap...');
    poolContract.on("Swap", async (sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick) => {
      console.log('Событие Swap получено!');

      const token0Amount = ethers.utils.formatUnits(amount0, token0Decimals); // Форматируем объем токена0 с учетом десятичных знаков
      const token1Amount = ethers.utils.formatUnits(amount1, token1Decimals); // Форматируем объем токена1 с учетом десятичных знаков

      // Рассчитываем и выводим цены токенов после каждой сделки
      const { priceToken0InToken1, priceToken1InToken0 } = calculatePrices(sqrtPriceX96, token0Decimals, token1Decimals);

      const currentTime = getCurrentTime(); // Получаем текущее время

      // Сохраняем информацию о сделке в массив
      const swapData = {
        time: currentTime,
        sender,
        recipient,
        amount0: token0Amount,
        amount1: token1Amount,
        priceToken0InToken1,
        priceToken1InToken0,
        tick,
      };

      allSwaps.push(swapData);

      // Записываем массив сделок в файл
      fs.writeFileSync(FILE_PATH, JSON.stringify(allSwaps, null, 2));

      // Вывод информации о сделке
      console.log(`\n=== Новая сделка (Время: ${currentTime}) ===`);
      console.log(`Отправитель: ${sender}`);
      console.log(`Получатель: ${recipient}`);
      console.log(`Объем токена0: ${token0Amount}`);
      console.log(`Объем токена1: ${token1Amount}`);
      console.log(`Цена Token0 относительно Token1: ${priceToken0InToken1}`);
      console.log(`Цена Token1 относительно Token0: ${priceToken1InToken0}`);

      // Отображаем диапазоны тиков
      displayTickRanges(tick, token0Decimals, token1Decimals, tickSpacing);

      // Выводим количество сохраненных сделок
      console.log(`Общее количество сделок: ${allSwaps.length}`);
    });

    console.log('Ожидание сделок...');
  } catch (error) {
    console.error('Ошибка при инициализации:', error);
  }
}

// Запускаем основной процесс
main().catch(console.error);
