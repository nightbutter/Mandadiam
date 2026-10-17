
const { attack } = require("./combat");

const player = {
    name: "Noctis",
    hp: 100,
    atk: 20,
    def: 5
};

const enemy = {
    name: "Slime",
    hp: 50,
    atk: 8,
    def: 7
};

console.log("=== BATTLE START ===");

let turn = 1;

while (player.hp > 0 && enemy.hp > 0) {
    console.log(`\n--- Turn ${turn} ---`);

    // ผู้เล่นโจมตีก่อน
    const playerResult = attack(player, enemy);
    console.log(
        `${player.name} โจมตี ${enemy.name} สร้าง ${playerResult.damage} ดาเมจ`
    );
    console.log(`HP ${enemy.name}: ${enemy.hp}`);

    // ถ้าศัตรูแพ้ จะไม่ตอบโต้
    if (enemy.hp <= 0) {
        console.log(`\n${enemy.name} พ่ายแพ้!`);
        break;
    }

    // ศัตรูตอบโต้
    const enemyResult = attack(enemy, player);
    console.log(
        `${enemy.name} โจมตี ${player.name} สร้าง ${enemyResult.damage} ดาเมจ`
    );
    console.log(`HP ${player.name}: ${player.hp}`);

    if (player.hp <= 0) {
        console.log(`\n${player.name} พ่ายแพ้!`);
        break;
    }

    turn++;
}

console.log("\n=== BATTLE END ===");
console.log(`${player.name}: ${player.hp} HP`);
console.log(`${enemy.name}: ${enemy.hp} HP`);
