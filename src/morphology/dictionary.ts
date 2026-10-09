export type StarterLemma = {
  lemma: string;
  pos: string;
  gloss: string;
  notes?: string;
  forms: { form: string; tags: string }[];
  examples: { text: string; translation: string }[];
};

export const RU_STARTER_DICTIONARY: StarterLemma[] = [
  {
    lemma: 'быть',
    pos: 'verb',
    gloss: 'to be',
    forms: [
      { form: 'быть', tags: 'inf' },
      { form: 'есть', tags: 'pres;3sg' },
      { form: 'был', tags: 'past;m' },
      { form: 'была', tags: 'past;f' },
      { form: 'было', tags: 'past;n' },
      { form: 'были', tags: 'past;pl' },
      { form: 'буду', tags: 'fut;1sg' },
      { form: 'будешь', tags: 'fut;2sg' },
      { form: 'будет', tags: 'fut;3sg' },
      { form: 'будем', tags: 'fut;1pl' },
      { form: 'будете', tags: 'fut;2pl' },
      { form: 'будут', tags: 'fut;3pl' },
    ],
    examples: [{ text: 'Я был дома.', translation: 'I was at home.' }],
  },
  {
    lemma: 'идти',
    pos: 'verb',
    gloss: 'to go (on foot)',
    forms: [
      { form: 'идти', tags: 'inf' },
      { form: 'иду', tags: 'pres;1sg' },
      { form: 'идёшь', tags: 'pres;2sg' },
      { form: 'идет', tags: 'pres;3sg' },
      { form: 'идём', tags: 'pres;1pl' },
      { form: 'идёте', tags: 'pres;2pl' },
      { form: 'идут', tags: 'pres;3pl' },
      { form: 'шёл', tags: 'past;m' },
      { form: 'шла', tags: 'past;f' },
      { form: 'шло', tags: 'past;n' },
      { form: 'шли', tags: 'past;pl' },
    ],
    examples: [{ text: 'Я иду в магазин.', translation: 'I am walking to the store.' }],
  },
  {
    lemma: 'читать',
    pos: 'verb',
    gloss: 'to read',
    forms: [
      { form: 'читать', tags: 'inf' },
      { form: 'читаю', tags: 'pres;1sg' },
      { form: 'читаешь', tags: 'pres;2sg' },
      { form: 'читает', tags: 'pres;3sg' },
      { form: 'читаем', tags: 'pres;1pl' },
      { form: 'читаете', tags: 'pres;2pl' },
      { form: 'читают', tags: 'pres;3pl' },
      { form: 'читал', tags: 'past;m' },
      { form: 'читала', tags: 'past;f' },
      { form: 'читали', tags: 'past;pl' },
    ],
    examples: [{ text: 'Она читает книгу.', translation: 'She is reading a book.' }],
  },
  {
    lemma: 'книга',
    pos: 'noun',
    gloss: 'book',
    notes: 'feminine',
    forms: [
      { form: 'книга', tags: 'nom;sg' },
      { form: 'книги', tags: 'gen;sg / nom;pl' },
      { form: 'книге', tags: 'dat/prep;sg' },
      { form: 'книгу', tags: 'acc;sg' },
      { form: 'книгой', tags: 'ins;sg' },
      { form: 'книг', tags: 'gen;pl' },
      { form: 'книгам', tags: 'dat;pl' },
      { form: 'книги', tags: 'acc;pl' },
      { form: 'книгами', tags: 'ins;pl' },
      { form: 'книгах', tags: 'prep;pl' },
    ],
    examples: [{ text: 'Это интересная книга.', translation: 'This is an interesting book.' }],
  },
  {
    lemma: 'стол',
    pos: 'noun',
    gloss: 'table',
    notes: 'masculine',
    forms: [
      { form: 'стол', tags: 'nom/acc;sg' },
      { form: 'стола', tags: 'gen;sg' },
      { form: 'столу', tags: 'dat;sg' },
      { form: 'столом', tags: 'ins;sg' },
      { form: 'столе', tags: 'prep;sg' },
      { form: 'столы', tags: 'nom/acc;pl' },
      { form: 'столов', tags: 'gen;pl' },
    ],
    examples: [{ text: 'Книга на столе.', translation: 'The book is on the table.' }],
  },
  {
    lemma: 'дом',
    pos: 'noun',
    gloss: 'house; home',
    notes: 'masculine',
    forms: [
      { form: 'дом', tags: 'nom/acc;sg' },
      { form: 'дома', tags: 'gen;sg / nom;pl' },
      { form: 'дому', tags: 'dat;sg' },
      { form: 'домом', tags: 'ins;sg' },
      { form: 'доме', tags: 'prep;sg' },
      { form: 'домов', tags: 'gen;pl' },
    ],
    examples: [{ text: 'Мы идём домой.', translation: 'We are going home.' }],
  },
  {
    lemma: 'вода',
    pos: 'noun',
    gloss: 'water',
    notes: 'feminine',
    forms: [
      { form: 'вода', tags: 'nom;sg' },
      { form: 'воды', tags: 'gen;sg' },
      { form: 'воде', tags: 'dat/prep;sg' },
      { form: 'воду', tags: 'acc;sg' },
      { form: 'водой', tags: 'ins;sg' },
    ],
    examples: [{ text: 'Я пью воду.', translation: 'I drink water.' }],
  },
  {
    lemma: 'красивый',
    pos: 'adjective',
    gloss: 'beautiful; handsome',
    forms: [
      { form: 'красивый', tags: 'm;nom;sg' },
      { form: 'красивая', tags: 'f;nom;sg' },
      { form: 'красивое', tags: 'n;nom;sg' },
      { form: 'красивые', tags: 'pl;nom' },
      { form: 'красивого', tags: 'm/n;gen;sg' },
      { form: 'красивой', tags: 'f;gen/dat/ins/prep;sg' },
      { form: 'красивым', tags: 'm;ins;sg' },
    ],
    examples: [{ text: 'Какой красивый дом!', translation: 'What a beautiful house!' }],
  },
  {
    lemma: 'хорошо',
    pos: 'adverb',
    gloss: 'well; good',
    forms: [{ form: 'хорошо', tags: 'adv' }],
    examples: [{ text: 'Ты хорошо читаешь.', translation: 'You read well.' }],
  },
  {
    lemma: 'я',
    pos: 'pronoun',
    gloss: 'I',
    forms: [
      { form: 'я', tags: 'nom' },
      { form: 'меня', tags: 'gen/acc' },
      { form: 'мне', tags: 'dat/prep' },
      { form: 'мной', tags: 'ins' },
    ],
    examples: [{ text: 'Я дома.', translation: 'I am at home.' }],
  },
];

export function normalizeRussian(input: string): string {
  return input.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}
