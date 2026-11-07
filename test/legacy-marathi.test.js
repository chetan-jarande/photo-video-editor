const test = require('node:test');
const assert = require('node:assert');
const { toLegacy, hasDevanagari } = require('../src/legacy-marathi.js');

// [unicode, ams, dg, infinity]; expected strings verified by rendering in AMS Aakash, AMS Lekhan 1, DGCally-03, DGCally-23-D, Infinity-15
const CASES = [
  ["नमस्कार", "namaskar", "namas|aar", "namas|aar"],
  ["महाराष्ट्र", "maharaVo^", "maharaÑ^", "maharaVo^"],
  ["श्री गणेशाय नमः", "MaI gaNaeSaaya nama:", "MaaI gaNaeSaaya nama:", "MaaI gaNaeSaaya nama:"],
  ["विठ्ठल", "ivaOxOla", "iavaþla", "iavaOxOla"],
  ["पांडुरंग", "paa/Dur/ga", "paa/Dur/ga", "paa/Dur/ga"],
  ["ज्ञानेश्वर", "zaanaeSvar", "zaanaeSvar", "zaanaeSvar"],
  ["तुकाराम", "taukarama", "tau|aarama", "tau|aarama"],
  ["माऊली", "maaWlaI", "maaWlaaI", "maaWlaaI"],
  ["आषाढी वारी", "AaVaaZI vaarI", "AaaVaaZaI vaaraI", "AaaVaaZaI vaaraI"],
  ["पंढरपूर", "pa/ZrpaUr", "pa/ZrpaUr", "pa/ZrpaUr"],
  ["पंढरीची वारी", "pa/ZrIcaI vaarI", "pa/ZraIcaaI vaaraI", "pa/ZraIcaaI vaaraI"],
  ["क्षमा", "Hamaa", "Hamaa", "Hamaa"],
  ["प्रेम", "paXema", "paXema", "paXema"],
  ["कृष्ण", "k&VNa", "|a&VNa", "|a&VNa"],
  ["कार्यक्रम", "kayaQkXma", "|aayaQ|aXma", "|aayaQ|aXma"],
  ["हार्दिक शुभेच्छा", "haidQk SauBaecCa", "haiadQ|a SauBaecCa", "haiadQ|a SauBaecCa"],
  ["दिवाळी", "idvaaLI", "iadvaaLaI", "iadvaaLaI"],
  ["स्थिती", "\\sTataI", "iasTataaI", "iasTataaI"],
  ["श्रद्धा", "MadxYaa", "MaÎa", "MadxYaa"],
  ["सत्य", "satya", "satya", "satya"],
  ["राम कृष्ण हरी", "rama k&VNa hrI", "rama |a&VNa hraI", "rama |a&VNa hraI"],
  ["ॐ", "Aae~", "_", "Aaae~"],
  ["धर्म", "YamaQ", "YamaQ", "YamaQ"],
  ["सूर्य", "saUyaQ", "saUyaQ", "saUyaQ"],
  ["मुंबई", "mau/baqQ", "mau/baqQ", "mau/baqQ"],
  ["इंद्र", "q/d^", "q/É", "q/d^"],
  ["आई", "AaqQ", "AaaqQ", "AaaqQ"],
  ["उद्धव", "wdxYava", "wÎva", "wdxYava"],
  ["विद्या", "ivadxyaa", "iavadxyaa", "iavadxyaa"],
  ["रुपये", "@payae", "@payae", "@payae"],
  ["रूप", "#pa", "ÿpa", "rUpa"],
  ["ओम नमः शिवाय।", "Aaema nama: iSavaaya a", "Aaaema nama: iaSavaaya a", "Aaaema nama: iaSavaaya a"],
  ["औषध", "AaEVaYa", "AaaEVaYa", "AaaEVaYa"],
  ["कुटुंब", "kuou/ba", "|auou/ba", "|auou/ba"],
  ["ऐश्वर्य", "FeSvayaQ", "FeSvayaQ", "FeSvayaQ"],
];

for (const [uni, ams, dg, inf] of CASES) {
  test(uni, () => {
    assert.strictEqual(toLegacy(uni, 'ams'), ams);
    assert.strictEqual(toLegacy(uni), ams);
    assert.strictEqual(toLegacy(uni, 'dg'), dg);
    assert.strictEqual(toLegacy(uni, 'infinity'), inf);
  });
}

test('non-Devanagari passes through unchanged', () => {
  assert.strictEqual(toLegacy('Hello 123'), 'Hello 123');
  assert.strictEqual(toLegacy('a\nb \u{1F389}'), 'a\nb \u{1F389}');
});

test('mixed string', () => {
  assert.strictEqual(toLegacy('आज Diwali आहे! \u{1F389} २०२५'), 'Aaja Diwali Aahe! \u{1F389} 2025');
});

test('Devanagari digits map to ASCII digits', () => {
  assert.strictEqual(toLegacy('१२३४५६७८९०'), '1234567890');
});

test('hasDevanagari', () => {
  assert.strictEqual(hasDevanagari('Hello'), false);
  assert.strictEqual(hasDevanagari('Hello नमस्कार'), true);
  assert.strictEqual(hasDevanagari(''), false);
});
