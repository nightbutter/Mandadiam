const assert = require("node:assert/strict");
const {
    validateCharacterInput
} = require("../../src/services/characterService");

console.log("=== Character Validation Tests ===");

function test(title, run) {
    run();
    console.log(`PASS: ${title}`);
}

const valid = { name: "Noctis", maxHp: 100, atk: 20, def: 5, spe: 4 };

test("valid input returns normalized values", () => {
    const { values, errors } = validateCharacterInput(valid);

    assert.equal(errors, undefined);
    assert.deepEqual(values, { name: "Noctis", maxHp: 100, atk: 20, def: 5, spe: 4 });
});

test("name is trimmed", () => {
    const { values } = validateCharacterInput({ ...valid, name: "  Slime  " });
    assert.equal(values.name, "Slime");
});

test("empty name rejected", () => {
    const { errors } = validateCharacterInput({ ...valid, name: "   " });
    assert(errors.some(e => e.startsWith("name")));
});

test("name over 50 chars rejected", () => {
    const { errors } = validateCharacterInput({ ...valid, name: "x".repeat(51) });
    assert(errors.some(e => e.startsWith("name")));
});

test("max_hp must be at least 1", () => {
    const { errors } = validateCharacterInput({ ...valid, maxHp: 0 });
    assert(errors.some(e => e.startsWith("max_hp")));
});

test("max_hp over limit rejected", () => {
    const { errors } = validateCharacterInput({ ...valid, maxHp: 10000 });
    assert(errors.some(e => e.startsWith("max_hp")));
});

test("negative stats rejected", () => {
    const { errors } = validateCharacterInput({ ...valid, atk: -1 });
    assert(errors.some(e => e.startsWith("atk")));
});

test("non-integer stats rejected", () => {
    const { errors } = validateCharacterInput({ ...valid, def: 2.5 });
    assert(errors.some(e => e.startsWith("def")));
});

test("zero stats allowed", () => {
    const { values } = validateCharacterInput({ ...valid, atk: 0, def: 0, spe: 0 });
    assert.equal(values.atk, 0);
});

test("multiple errors reported together", () => {
    const { errors } = validateCharacterInput({ name: "", maxHp: 0, atk: -1, def: 5, spe: 4 });
    assert(errors.length >= 3);
});

console.log("\nCharacter validation tests passed.");
