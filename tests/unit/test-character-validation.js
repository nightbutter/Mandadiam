const assert = require("node:assert/strict");
const {
    RULES,
    validateCharacterInput
} = require("../../src/services/characterService");

console.log("=== Character Validation Tests ===");
console.log(
    `Rules: name ${RULES.name.min}-${RULES.name.max}, ` +
    `hp ${RULES.maxHp.min}-${RULES.maxHp.max}, ` +
    `stats ${RULES.stat.min}-${RULES.stat.max}, budget ${RULES.budget}`
);

function test(title, run) {
    run();
    console.log(`PASS: ${title}`);
}

const valid = { name: "Noctis", maxHp: 100, atk: 20, def: 5, spe: 4 }; // 129/150

test("valid input returns normalized values", () => {
    const { values, errors } = validateCharacterInput(valid);

    assert.equal(errors, undefined);
    assert.deepEqual(values, { name: "Noctis", maxHp: 100, atk: 20, def: 5, spe: 4 });
});

test("exactly at budget is allowed", () => {
    const { errors } = validateCharacterInput(
        { name: "Max", maxHp: 90, atk: 30, def: 10, spe: 20 } // 150
    );

    assert.equal(errors, undefined);
});

test("one point over budget is rejected", () => {
    const { errors } = validateCharacterInput(
        { name: "Over", maxHp: 91, atk: 30, def: 10, spe: 20 } // 151
    );

    assert(errors.some(e => e.includes("budget")));
});

test("hp and stats share the same budget", () => {
    const { errors } = validateCharacterInput(
        { name: "Tank", maxHp: 150, atk: 10, def: 10, spe: 0 } // 170
    );

    assert(errors.some(e => e.includes("budget")));
});

test("max_hp bounds enforced", () => {
    assert(validateCharacterInput({ ...valid, maxHp: 49 })
        .errors.some(e => e.startsWith("max_hp")));
    assert(validateCharacterInput({ ...valid, maxHp: 151 })
        .errors.some(e => e.startsWith("max_hp")));
});

test("stat bounds enforced at 0-30", () => {
    assert(validateCharacterInput({ ...valid, atk: 31 })
        .errors.some(e => e.startsWith("atk")));
    assert(validateCharacterInput({ ...valid, def: -1 })
        .errors.some(e => e.startsWith("def")));
    assert(validateCharacterInput({ ...valid, spe: 999 })
        .errors.some(e => e.startsWith("spe")));
});

test("non-integer stats rejected", () => {
    assert(validateCharacterInput({ ...valid, def: 2.5 })
        .errors.some(e => e.startsWith("def")));
});

test("name bounds enforced at 1-30", () => {
    assert(validateCharacterInput({ ...valid, name: "   " })
        .errors.some(e => e.startsWith("name")));
    assert(validateCharacterInput({ ...valid, name: "x".repeat(31) })
        .errors.some(e => e.startsWith("name")));
});

test("name is trimmed", () => {
    const { values } = validateCharacterInput({ ...valid, name: "  Slime  " });
    assert.equal(values.name, "Slime");
});

test("multiple errors reported together", () => {
    const { errors } = validateCharacterInput(
        { name: "", maxHp: 0, atk: -1, def: 5, spe: 4 }
    );

    assert(errors.length >= 3);
});

console.log("\nCharacter validation tests passed.");
