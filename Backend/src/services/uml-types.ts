// Misma tabla que Frontend/src/app/core/utils/uml-types.ts
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

function normalizeMembers(attrs: any, methods: any) {
  if (Array.isArray(attrs)) attrs.forEach((a) => { if (a?.type) a.type = normalizeUmlType(a.type); });
  if (Array.isArray(methods)) methods.forEach((m) => { if (m?.returnType) m.returnType = normalizeUmlType(m.returnType); });
}

// Unifica los tipos de las clases que propone la IA (Gemini o local) antes de guardarlas.
export function normalizePayloadTypes(payload: any): void {
  const lists = [payload?.classesGenerated, payload?.classes, payload?.nodes, payload?.classesModified];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const cls of list) {
      normalizeMembers(cls?.attributes, cls?.methods);
      normalizeMembers(cls?.attributesToAdd, cls?.methodsToAdd);
    }
  }
}
