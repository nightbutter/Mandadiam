
const { attack } = require("../../src/game/combat");

function createCharacters() {
    return {
        noctis: {
            name: "Noctis",
            hp: 100,
            atk: 20,
            def: 5,
            spe: 4
        },
        slime: {
            name: "Slime",
            hp: 50,
            atk: 8,
            def: 7,
            spe: 2
        }
    };
}

function runTest(title, type, roll, expectedDamage) {
    const { noctis, slime } = createCharacters();

    const result = attack(noctis, slime, { type, roll });

    console.log(`\n=== ${title} ===`);
    console.log(`ประเภท: ${type}`);
    console.log(`ผลเต๋า d8: ${roll}`);
    console.log(`ดาเมจที่คาดหวัง: ${expectedDamage}`);
    console.log(`ดาเมจที่ได้จริง: ${result.damage}`);
    console.log(`Critical: ${result.critical}`);
    console.log(`HP Slime ที่เหลือ: ${slime.hp}`);

    if (result.damage !== expectedDamage) {
        throw new Error(
            `FAIL: คาดหวัง ${expectedDamage} แต่ได้ ${result.damage}`
        );
    }

    console.log("PASS");
}

console.log("=== RPG Combat Formula Tests ===");

runTest("โจมตีปกติ", "normal", 5, 18);
runTest("Critical โจมตีปกติ", "normal", 8, 49);
runTest("ใช้สกิล", "skill", 5, 22);
runTest("Critical สกิล", "skill", 8, 57);

console.log("\nทดสอบสูตรทั้งหมดผ่าน");
