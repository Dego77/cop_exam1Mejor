// Tipos de dato oficiales del diagrama: un solo nombre por tipo, con mayúscula inicial.
export const UML_TYPES = ['Integer', 'Long', 'Double', 'Boolean', 'String', 'Char', 'Date', 'UUID'];

const SYNONYMS: Record<string, string> = {
  int: 'Integer', integer: 'Integer',
  long: 'Long',
  double: 'Double', float: 'Double', decimal: 'Double', number: 'Double', real: 'Double',
  bool: 'Boolean', boolean: 'Boolean',
  string: 'String', varchar: 'String', text: 'String',
  char: 'Char',
  date: 'Date', datetime: 'Date', timestamp: 'Date',
  uuid: 'UUID',
  void: 'void',
  arrays: 'List',
};

// Unifica sinónimos (int, double, bool...). Nombres de clase o List<X> quedan igual.
export function normalizeUmlType(raw: string | null | undefined): string {
  const value = (raw || '').trim();
  return SYNONYMS[value.toLowerCase()] || value;
}
