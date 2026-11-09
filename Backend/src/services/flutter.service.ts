import fs from 'fs';
import JSZip from 'jszip';

/**
 * Genera un proyecto Flutter (lib/ + pubspec.yaml + assets/ + README) a partir del mismo
 * JSON canónico de entidades que usa SpringBootGeneratorService, para que quede embebido como
 * carpeta hermana ("flutter_app/") dentro del mismo .zip que el backend Spring Boot.
 *
 * Alcance deliberado (ver plan): las pantallas CRUD generadas solo editan los atributos
 * escalares de cada entidad (ent.attributes), no las relaciones (@ManyToOne/@OneToMany/
 * @ManyToMany se sirven vía JSON anidado o se ignoran vía @JsonIgnore en el backend) — es un
 * andamiaje funcional para arrancar, no una app terminada a medida del diagrama.
 */
export class FlutterGeneratorService {
  private static toDartFileName(className: string): string {
    return className.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }

  private static toLowerCamel(className: string): string {
    return className.charAt(0).toLowerCase() + className.slice(1);
  }

  /**
   * Devuelve los atributos "efectivos" de una entidad incluyendo los heredados de su/sus
   * ancestros de herencia (SINGLE_TABLE): Jackson serializa TODOS los campos heredados en el
   * JSON de una clase hija (incluida la PK, que vive en la raíz), así que el modelo/pantalla
   * Flutter necesita conocerlos también, no solo ent.attributes (que solo trae lo propio).
   */
  private static getEffectiveAttributes(ent: any, byClassName: Map<string, any>): any[] {
    const chain: any[] = [];
    const visited = new Set<string>();
    let current: any = ent;
    while (current) {
      chain.unshift(current);
      if (!current.isInheritanceChild || !current.parentClass || visited.has(current.parentClass)) break;
      visited.add(current.parentClass);
      current = byClassName.get(current.parentClass);
    }
    const seen = new Set<string>();
    const flat: any[] = [];
    chain.forEach((e) => {
      (e.attributes || []).forEach((a: any) => {
        if (!seen.has(a.name)) {
          seen.add(a.name);
          flat.push(a);
        }
      });
    });
    return flat;
  }

  private static javaTypeToDart(javaType: string): string {
    if (javaType === 'Integer' || javaType === 'Long') return 'int';
    if (javaType === 'Double') return 'double';
    if (javaType === 'Boolean') return 'bool';
    if (javaType && javaType.includes('LocalDateTime')) return 'DateTime';
    return 'String';
  }

  private static dartFromJsonExpr(key: string, dartType: string): string {
    if (dartType === 'int') return `json['${key}'] as int?`;
    if (dartType === 'double') return `(json['${key}'] as num?)?.toDouble()`;
    if (dartType === 'bool') return `json['${key}'] as bool?`;
    if (dartType === 'DateTime') return `json['${key}'] != null ? DateTime.tryParse(json['${key}'].toString()) : null`;
    return `json['${key}'] as String?`;
  }

  private static dartToJsonExpr(fieldName: string, dartType: string): string {
    if (dartType === 'DateTime') return `${fieldName}?.toIso8601String()`;
    return fieldName;
  }

  // ---------------------------------------------------------------------
  // pubspec.yaml / configuración
  // ---------------------------------------------------------------------

  private static generatePubspecYaml(projectName: string, includeVosk: boolean): string {
    const pkgName = `${this.toDartFileName(projectName)}_app`;
    const voskAsset = includeVosk ? '\n    - assets/models/vosk-model-small-es-0.42.zip' : '';
    return `name: ${pkgName}
description: "App Flutter generada automaticamente por ClassForge para ${projectName}: guarda por voz sin internet y sincroniza con el backend Spring Boot."
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.3.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  http: ^1.6.0
  flutter_tts: ^4.2.5
  sherpa_onnx: 2.0.1
  piper_phonemize: ^1.5.9
  archive: 3.6.1
  audioplayers: ^6.8.1
  flutter_gemma: ^1.8.3
  flutter_gemma_litertlm: ^1.6.4
  vosk_flutter_2: ^1.0.0
  sqflite: ^2.4.2
  path: ^1.9.1
  path_provider: ^2.1.5
  permission_handler: ^11.4.0
  file_picker: ^8.1.7

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/schema_context.json${voskAsset}
`;
  }

  private static generateAnalysisOptions(): string {
    return `include: package:flutter_lints/flutter.yaml\n`;
  }

  private static generateApiConfigDart(): string {
    return `/// Configura aqui la URL base del backend Spring Boot generado por ClassForge.
/// - Emulador Android: usa 10.0.2.2 en vez de localhost para llegar a tu maquina host.
/// - iOS Simulator / desktop: localhost funciona normalmente.
/// - Dispositivo fisico: usa la IP real de tu maquina en la red local (ej. 192.168.x.x).
class ApiConfig {
  static const String baseUrl = 'http://10.0.2.2:8080/api/v1';
}
`;
  }

  // ---------------------------------------------------------------------
  // Modelos Dart
  // ---------------------------------------------------------------------

  private static generateModelDart(ent: any): string {
    const className = ent.className;
    const attrs = (ent.attributes || []).map((a: any) => ({
      name: a.name,
      dartType: this.javaTypeToDart(a.type),
    }));

    const fields = attrs.map((a: any) => `  final ${a.dartType}? ${a.name};`).join('\n');
    const ctorParams = attrs.map((a: any) => `this.${a.name}`).join(', ');
    const fromJson = attrs
      .map((a: any) => `    ${a.name}: ${this.dartFromJsonExpr(a.name, a.dartType)},`)
      .join('\n');
    const toJson = attrs
      .map((a: any) => `      '${a.name}': ${this.dartToJsonExpr(a.name, a.dartType)},`)
      .join('\n');

    return `// Generado por ClassForge a partir de la clase UML "${className}".
// Solo incluye los atributos escalares propios; las relaciones (@ManyToOne/@OneToMany/
// @ManyToMany) no se modelan aqui (ver limitaciones en README.md).
class ${className} {
${fields}

  ${className}({${ctorParams}});

  factory ${className}.fromJson(Map<String, dynamic> json) {
    return ${className}(
${fromJson}
    );
  }

  Map<String, dynamic> toJson() {
    return {
${toJson}
    };
  }
}
`;
  }

  // ---------------------------------------------------------------------
  // Servicio API genérico (un método CRUD por entidad)
  // ---------------------------------------------------------------------

  private static generateApiServiceDart(entities: any[]): string {
    const imports = entities
      .map((e) => `import '../models/${this.toDartFileName(e.className)}.dart';`)
      .join('\n');

    const methods = entities
      .map((ent) => {
        const className = ent.className;
        const varName = this.toLowerCamel(className);
        const pluralVar = varName.endsWith('s') ? varName : `${varName}s`;
        const endpoint = ent.tableName;
        const pkName = ent.effectivePk ? ent.effectivePk.name : 'id';

        const listAndCreate = `  Future<List<${className}>> get${className}List() async {
    final res = await http.get(Uri.parse('\${ApiConfig.baseUrl}/${endpoint}'));
    if (res.statusCode != 200) {
      throw Exception('Error al obtener ${endpoint}: HTTP \${res.statusCode}');
    }
    final List<dynamic> data = jsonDecode(utf8.decode(res.bodyBytes)) as List<dynamic>;
    return data.map((e) => ${className}.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<${className}> create${className}(${className} ${pluralVar}Item) async {
    final res = await http.post(
      Uri.parse('\${ApiConfig.baseUrl}/${endpoint}'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(${pluralVar}Item.toJson()),
    );
    if (res.statusCode != 200 && res.statusCode != 201) {
      throw Exception('Error al crear ${endpoint}: HTTP \${res.statusCode}');
    }
    return ${className}.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }`;

        // Las Clases de Asociación (PK compuesta, p. ej. Detalle_ventas) solo exponen
        // GET/POST en el backend generado (ver generateControllerJava en springboot.service.ts:
        // su @EmbeddedId no se puede bindear desde un solo segmento de URL), así que aquí
        // tampoco se generan update/delete por id para no apuntar a endpoints inexistentes.
        if (ent.isAssociationClass) {
          return listAndCreate;
        }

        return `${listAndCreate}

  Future<${className}> update${className}(dynamic ${pkName}, ${className} ${pluralVar}Item) async {
    final res = await http.put(
      Uri.parse('\${ApiConfig.baseUrl}/${endpoint}/\$${pkName}'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(${pluralVar}Item.toJson()),
    );
    if (res.statusCode != 200) {
      throw Exception('Error al actualizar ${endpoint}: HTTP \${res.statusCode}');
    }
    return ${className}.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  Future<void> delete${className}(dynamic ${pkName}) async {
    final res = await http.delete(Uri.parse('\${ApiConfig.baseUrl}/${endpoint}/\$${pkName}'));
    if (res.statusCode != 200 && res.statusCode != 204) {
      throw Exception('Error al eliminar ${endpoint}: HTTP \${res.statusCode}');
    }
  }`;
      })
      .join('\n\n');

    return `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
${imports}

/// Cliente REST generico contra el backend Spring Boot generado por ClassForge.
/// Cada entidad del diagrama tiene su propio bloque get/create/update/delete aqui,
/// apuntando a los mismos endpoints /api/v1/<tabla> que expone ese backend.
class ApiService {
${methods}
}
`;
  }

  // ---------------------------------------------------------------------
  // Pantalla CRUD genérica por entidad
  // ---------------------------------------------------------------------

  /**
   * Pantalla CRUD reducida (solo listar + crear) para una Clase de Asociación (PK compuesta,
   * p. ej. Detalle_ventas), ya que su backend generado no expone update/delete por id
   * (un @EmbeddedId no se puede bindear desde un solo segmento de URL sin un Converter propio;
   * ver generateControllerJava en springboot.service.ts).
   */
  private static generateAssocClassListScreenDart(ent: any, fileBase: string, editableAttrs: any[], titleAttr: string): string {
    const className = ent.className;

    const initControllers = editableAttrs
      .map((a: any) => `      '${a.name}': TextEditingController(),`)
      .join('\n');

    const formFields = editableAttrs
      .map((a: any) => {
        const keyboardTypeLine = a.dartType === 'int' || a.dartType === 'double'
          ? `\n                keyboardType: TextInputType.number,`
          : '';
        return `              TextFormField(
                controller: controllers['${a.name}'],
                decoration: const InputDecoration(labelText: '${a.name}'),${keyboardTypeLine}
              ),`;
      })
      .join('\n');

    const buildItemFromControllers = editableAttrs
      .map((a: any) => {
        const c = `controllers['${a.name}']!.text.trim()`;
        if (a.dartType === 'int') return `      ${a.name}: int.tryParse(${c}),`;
        if (a.dartType === 'double') return `      ${a.name}: double.tryParse(${c}),`;
        if (a.dartType === 'bool') return `      ${a.name}: ${c}.toLowerCase() == 'true',`;
        if (a.dartType === 'DateTime') return `      ${a.name}: ${c}.isEmpty ? null : DateTime.tryParse(${c}),`;
        return `      ${a.name}: ${c}.isEmpty ? null : ${c},`;
      })
      .join('\n');

    return `import 'package:flutter/material.dart';
import '../models/${fileBase}.dart';
import '../services/api_service.dart';

/// Pantalla para "${className}" (Clase de Asociación, PK compuesta), generada por ClassForge.
/// Solo permite listar y crear registros: el backend generado no expone update/delete por id
/// para este tipo de entidad (ver README.md).
class ${className}ListScreen extends StatefulWidget {
  const ${className}ListScreen({super.key});

  @override
  State<${className}ListScreen> createState() => _${className}ListScreenState();
}

class _${className}ListScreenState extends State<${className}ListScreen> {
  final ApiService _api = ApiService();
  late Future<List<${className}>> _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _future = _api.get${className}List();
  }

  Future<void> _openForm() async {
    final controllers = <String, TextEditingController>{
${initControllers}
    };

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nuevo ${className}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
${formFields}
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Guardar')),
        ],
      ),
    );

    if (saved != true) {
      for (final c in controllers.values) {
        c.dispose();
      }
      return;
    }

    final item = ${className}(
${buildItemFromControllers}
    );

    for (final c in controllers.values) {
      c.dispose();
    }

    try {
      await _api.create${className}(item);
      setState(_reload);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: \$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${className}')),
      body: FutureBuilder<List<${className}>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error: \${snapshot.error}'));
          }
          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return const Center(child: Text('Sin registros todavia.'));
          }
          return ListView.builder(
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              return ListTile(
                title: Text('\${item.${titleAttr}}'),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _openForm,
        child: const Icon(Icons.add),
      ),
    );
  }
}
`;
  }

  private static generateListScreenDart(ent: any): string {
    const className = ent.className;
    const fileBase = this.toDartFileName(className);
    const attrs = (ent.attributes || []).map((a: any) => ({
      name: a.name,
      dartType: this.javaTypeToDart(a.type),
      isPrimaryKey: !!a.isPrimaryKey,
    }));
    // Las Clases de Asociación tienen PK compuesta (@EmbeddedId, ver springboot.service.ts):
    // sus atributos PK (las dos FK) SÍ deben quedar editables en el formulario de creación,
    // ya que no hay ningún otro campo para elegir con qué par de entidades se relaciona.
    const editableAttrs = ent.isAssociationClass ? attrs : attrs.filter((a: any) => !a.isPrimaryKey);
    const pkName = ent.effectivePk ? ent.effectivePk.name : 'id';
    const titleAttr = (attrs.find((a: any) => a.dartType === 'String' && !a.isPrimaryKey) || attrs[0] || { name: pkName }).name;

    if (ent.isAssociationClass) {
      return this.generateAssocClassListScreenDart(ent, fileBase, editableAttrs, titleAttr);
    }

    const initControllers = editableAttrs
      .map((a: any) => `      '${a.name}': TextEditingController(text: existing?.${a.name}?.toString() ?? ''),`)
      .join('\n');

    const formFields = editableAttrs
      .map((a: any) => {
        const keyboardTypeLine = a.dartType === 'int' || a.dartType === 'double'
          ? `\n                keyboardType: TextInputType.number,`
          : '';
        return `              TextFormField(
                controller: controllers['${a.name}'],
                decoration: const InputDecoration(labelText: '${a.name}'),${keyboardTypeLine}
              ),`;
      })
      .join('\n');

    const buildItemFromControllers = editableAttrs
      .map((a: any) => {
        const c = `controllers['${a.name}']!.text.trim()`;
        if (a.dartType === 'int') return `      ${a.name}: int.tryParse(${c}),`;
        if (a.dartType === 'double') return `      ${a.name}: double.tryParse(${c}),`;
        if (a.dartType === 'bool') return `      ${a.name}: ${c}.toLowerCase() == 'true',`;
        if (a.dartType === 'DateTime') return `      ${a.name}: ${c}.isEmpty ? null : DateTime.tryParse(${c}),`;
        return `      ${a.name}: ${c}.isEmpty ? null : ${c},`;
      })
      .join('\n');

    return `import 'package:flutter/material.dart';
import '../models/${fileBase}.dart';
import '../services/api_service.dart';

/// Pantalla CRUD generica para "${className}", generada por ClassForge.
/// Solo permite editar los atributos escalares (ver limitaciones en README.md).
class ${className}ListScreen extends StatefulWidget {
  const ${className}ListScreen({super.key});

  @override
  State<${className}ListScreen> createState() => _${className}ListScreenState();
}

class _${className}ListScreenState extends State<${className}ListScreen> {
  final ApiService _api = ApiService();
  late Future<List<${className}>> _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _future = _api.get${className}List();
  }

  Future<void> _openForm({${className}? existing}) async {
    final controllers = <String, TextEditingController>{
${initControllers}
    };

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(existing == null ? 'Nuevo ${className}' : 'Editar ${className}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
${formFields}
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Guardar')),
        ],
      ),
    );

    if (saved != true) {
      for (final c in controllers.values) {
        c.dispose();
      }
      return;
    }

    final item = ${className}(
${buildItemFromControllers}
    );

    for (final c in controllers.values) {
      c.dispose();
    }

    try {
      if (existing == null) {
        await _api.create${className}(item);
      } else {
        await _api.update${className}(existing.${pkName}, item);
      }
      setState(_reload);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: \$e')));
    }
  }

  Future<void> _delete(${className} item) async {
    try {
      await _api.delete${className}(item.${pkName});
      setState(_reload);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error al eliminar: \$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${className}')),
      body: FutureBuilder<List<${className}>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error: \${snapshot.error}'));
          }
          final items = snapshot.data ?? [];
          if (items.isEmpty) {
            return const Center(child: Text('Sin registros todavia.'));
          }
          return ListView.builder(
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              return ListTile(
                title: Text('\${item.${titleAttr}}'),
                subtitle: Text('${pkName}: \${item.${pkName}}'),
                onTap: () => _openForm(existing: item),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _delete(item),
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openForm(),
        child: const Icon(Icons.add),
      ),
    );
  }
}
`;
  }

  // ---------------------------------------------------------------------
  // IA local on-device (Gemma via flutter_gemma) + pantalla de chat/voz
  // ---------------------------------------------------------------------

  private static generatePiperVoiceDart(): string {
    return `import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:piper_phonemize/piper_phonemize.dart' as piper;
import 'package:sherpa_onnx/sherpa_onnx.dart' as sherpa;

/// Deja solo el modelo y tokens.txt. El resto, sobre todo espeak, no hace falta para hablar.
List<(String, Uint8List)> unpackVoicePack(Uint8List packed) {
  final tarBytes = BZip2Decoder().decodeBytes(packed);
  final archive = TarDecoder().decodeBytes(tarBytes);
  final kept = <(String, Uint8List)>[];
  for (final file in archive) {
    if (!file.isFile) continue;
    final name = file.name.replaceAll('\\\\', '/');
    if (name.contains('espeak-ng-data/')) continue;
    final base = name.split('/').last;
    if (base != 'tokens.txt' && !base.endsWith('.onnx')) continue;
    final content = file.content;
    final bytes = content is Uint8List
        ? Uint8List.fromList(content)
        : Uint8List.fromList(List<int>.from(content as List));
    kept.add((base, bytes));
  }
  return kept;
}

/// Una voz Piper en español. Se descarga una vez y después habla sin internet.
class SpanishVoice {
  const SpanishVoice({
    required this.id,
    required this.label,
    required this.place,
    required this.kind,
    required this.megabytes,
    required this.pack,
    required this.modelFile,
    required this.espeak,
    this.speaker = 0,
  });

  final String id;
  final String label;
  final String place;
  final String kind;
  final int megabytes;
  final String pack;
  final String modelFile;
  final String espeak;
  final int speaker;

  String get url =>
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$pack.tar.bz2';
}

/// Voces Piper guardadas en el teléfono.
class PiperVoice {
  static const catalog = <SpanishVoice>[
    SpanishVoice(
      id: 'claude',
      label: 'Claude',
      place: 'México',
      kind: 'Femenina',
      megabytes: 64,
      pack: 'vits-piper-es_MX-claude-high',
      modelFile: 'es_MX-claude-high.onnx',
      espeak: 'es-419',
    ),
    SpanishVoice(
      id: 'sharvard-mujer',
      label: 'Sharvard mujer',
      place: 'España',
      kind: 'Femenina',
      megabytes: 77,
      pack: 'vits-piper-es_ES-sharvard-medium',
      modelFile: 'es_ES-sharvard-medium.onnx',
      espeak: 'es',
      speaker: 1,
    ),
    SpanishVoice(
      id: 'daniela',
      label: 'Daniela',
      place: 'Argentina',
      kind: 'Femenina',
      megabytes: 110,
      pack: 'vits-piper-es_AR-daniela-high',
      modelFile: 'es_AR-daniela-high.onnx',
      espeak: 'es-419',
    ),
    SpanishVoice(
      id: 'glados',
      label: 'GLaDOS',
      place: 'España',
      kind: 'Femenina, sintética',
      megabytes: 64,
      pack: 'vits-piper-es_ES-glados-medium',
      modelFile: 'es_ES-glados-medium.onnx',
      espeak: 'es',
    ),
    SpanishVoice(
      id: 'ald',
      label: 'Ald',
      place: 'México',
      kind: 'Masculina',
      megabytes: 64,
      pack: 'vits-piper-es_MX-ald-medium',
      modelFile: 'es_MX-ald-medium.onnx',
      espeak: 'es-419',
    ),
    SpanishVoice(
      id: 'davefx',
      label: 'Davefx',
      place: 'España',
      kind: 'Masculina',
      megabytes: 64,
      pack: 'vits-piper-es_ES-davefx-medium',
      modelFile: 'es_ES-davefx-medium.onnx',
      espeak: 'es',
    ),
    SpanishVoice(
      id: 'sharvard',
      label: 'Sharvard',
      place: 'España',
      kind: 'Masculina',
      megabytes: 77,
      pack: 'vits-piper-es_ES-sharvard-medium',
      modelFile: 'es_ES-sharvard-medium.onnx',
      espeak: 'es',
    ),
    SpanishVoice(
      id: 'miro',
      label: 'Miro',
      place: 'España',
      kind: 'Masculina',
      megabytes: 64,
      pack: 'vits-piper-es_ES-miro-high',
      modelFile: 'es_ES-miro-high.onnx',
      espeak: 'es',
    ),
  ];

  sherpa.OfflineTts? _tts;
  final AudioPlayer _player = AudioPlayer();
  SpanishVoice _current = catalog.first;
  String? _loadedId;
  bool _ready = false;
  bool _phonemeReady = false;
  String? failure;

  bool get isReady => _ready;
  SpanishVoice get current => _current;
  String get label => _current.label;

  Future<bool> prepare() async {
    final saved = await _savedVoice();
    return use(saved);
  }

  Future<Set<String>> installedIds() async {
    final ready = <String>{};
    for (final voice in catalog) {
      if (await _fileReady(voice)) ready.add(voice.id);
    }
    return ready;
  }

  /// Abre la voz si ya está en el teléfono. Si se pasa [onProgress], la descarga.
  Future<bool> use(SpanishVoice voice, {void Function(double percent)? onProgress}) async {
    _current = voice;
    await _saveChoice(voice.id);
    if (_ready && _loadedId == voice.id) return true;
    if (_ready && _loadedId != null && _sameModel(_loadedId!, voice)) {
      _loadedId = voice.id;
      return true;
    }
    failure = null;
    _ready = false;
    _tts?.free();
    _tts = null;
    _loadedId = null;
    try {
      var dir = await _locate(voice);
      if (dir == null && onProgress != null) {
        final downloaded = await _download(voice, onProgress);
        if (!downloaded) return false;
        dir = await _locate(voice);
      }
      if (dir == null) {
        failure = '\${voice.label} no está en el teléfono. Elígela con internet para descargarla.';
        return false;
      }
      onProgress?.call(-2);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      return await _open(voice, dir);
    } catch (e) {
      _ready = false;
      failure = '\${voice.label} no abrió: $e';
      return false;
    }
  }

  Future<bool> _download(SpanishVoice voice, void Function(double percent) onProgress) async {
    HttpClient? client;
    try {
      client = HttpClient();
      final request = await client.getUrl(Uri.parse(voice.url));
      final response = await request.close();
      if (response.statusCode != 200) {
        failure = 'No pude descargar \${voice.label}. El servidor respondió \${response.statusCode}.';
        return false;
      }
      final total = response.contentLength;
      final packed = BytesBuilder(copy: false);
      var received = 0;
      await for (final chunk in response) {
        packed.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress(received * 100 / total);
      }
      onProgress(100);
      onProgress(-1);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final kept = await compute(unpackVoicePack, packed.takeBytes());
      if (kept.isEmpty) {
        failure = 'La descarga de \${voice.label} no trajo el archivo de la voz.';
        return false;
      }
      final stored = await _voiceDir(voice);
      await stored.create(recursive: true);
      for (final piece in kept) {
        final out = File('\${stored.path}/\${piece.$1}');
        await out.parent.create(recursive: true);
        await out.writeAsBytes(piece.$2, flush: true);
      }
      return true;
    } catch (e) {
      failure = 'No pude descargar \${voice.label}: $e';
      return false;
    } finally {
      client?.close(force: true);
    }
  }

  Future<bool> _open(SpanishVoice voice, Directory dir) async {
    sherpa.initBindings();
    _tts = sherpa.OfflineTts(
      sherpa.OfflineTtsConfig(
        model: sherpa.OfflineTtsModelConfig(
          vits: sherpa.OfflineTtsVitsModelConfig(
            model: '\${dir.path}/\${voice.modelFile}',
            tokens: '\${dir.path}/tokens.txt',
            dataDir: '\${dir.path}/espeak-ng-data',
          ),
          numThreads: 2,
          provider: 'cpu',
        ),
      ),
    );
    await _initPhonemes();
    final probe = _synthesize('Hola');
    if (probe.samples.isEmpty) {
      failure = '\${voice.label} está en el teléfono, pero no pudo generar la voz.';
      _ready = false;
      _tts?.free();
      _tts = null;
      return false;
    }
    _loadedId = voice.id;
    _ready = true;
    return true;
  }

  Future<void> _initPhonemes() async {
    if (_phonemeReady) return;
    await piper.initBindingsAsync();
    final dataDir = await piper.extractEspeakNgData();
    final code = piper.PiperPhonemize.initialize(dataDir);
    if (code < 0) {
      throw Exception('No pude preparar la pronunciación.');
    }
    _phonemeReady = true;
  }

  sherpa.GeneratedAudio _synthesize(String text) {
    final engine = _tts;
    if (engine == null) {
      return sherpa.GeneratedAudio(samples: Float32List(0), sampleRate: 0);
    }
    final primary = _current.espeak;
    final secondary = primary == 'es' ? 'es-419' : 'es';
    var phonemes = piper.PiperPhonemize.phonemize(text, voice: primary);
    if (phonemes.every((sentence) => sentence.isEmpty)) {
      phonemes = piper.PiperPhonemize.phonemize(text, voice: secondary);
    }
    final usable = phonemes.where((sentence) => sentence.isNotEmpty).toList();
    if (usable.isEmpty) {
      return sherpa.GeneratedAudio(samples: Float32List(0), sampleRate: 0);
    }
    return engine.generateWithConfig(
      text: '',
      config: sherpa.OfflineTtsGenerationConfig(
        sid: _current.speaker,
        speed: 0.95,
        phonemeCodepoints: usable,
      ),
    );
  }

  Future<bool> speak(String text) async {
    final spoken = text.trim();
    if (_tts == null || spoken.isEmpty) return false;
    await _initPhonemes();
    final audio = _synthesize(spoken);
    if (audio.samples.isEmpty) {
      failure = '\${_current.label} no generó audio. Sigue la voz del teléfono.';
      return false;
    }
    final docs = await getApplicationDocumentsDirectory();
    final file = File('\${docs.path}/piper-last.wav');
    await file.writeAsBytes(_wav(audio.samples, audio.sampleRate), flush: true);
    await _player.stop();
    await _player.play(DeviceFileSource(file.path));
    await _player.onPlayerComplete.first;
    return true;
  }

  Future<void> stop() async {
    try {
      await _player.stop();
    } catch (_) {}
  }

  bool _sameModel(String loadedId, SpanishVoice voice) {
    for (final item in catalog) {
      if (item.id == loadedId) {
        return item.pack == voice.pack && item.modelFile == voice.modelFile;
      }
    }
    return false;
  }

  Future<SpanishVoice> _savedVoice() async {
    try {
      final file = File('\${(await getApplicationDocumentsDirectory()).path}/piper-voice.txt');
      if (await file.exists()) {
        final id = (await file.readAsString()).trim();
        for (final voice in catalog) {
          if (voice.id == id) return voice;
        }
      }
    } catch (_) {}
    return catalog.first;
  }

  Future<void> _saveChoice(String id) async {
    final file = File('\${(await getApplicationDocumentsDirectory()).path}/piper-voice.txt');
    await file.writeAsString(id);
  }

  Future<Directory> _voiceDir(SpanishVoice voice) async {
    final docs = await getApplicationDocumentsDirectory();
    return Directory('\${docs.path}/piper/\${voice.pack}');
  }

  Future<bool> _fileReady(SpanishVoice voice) async {
    final nested = File('\${(await _voiceDir(voice)).path}/\${voice.modelFile}');
    if (await nested.exists() && await nested.length() > 1000000) return true;
    if (voice.id == 'claude') {
      final docs = await getApplicationDocumentsDirectory();
      final flat = File('\${docs.path}/piper/\${voice.modelFile}');
      if (await flat.exists() && await flat.length() > 1000000) return true;
    }
    return false;
  }

  Future<Directory?> _locate(SpanishVoice voice) async {
    final nested = await _voiceDir(voice);
    final nestedModel = File('\${nested.path}/\${voice.modelFile}');
    if (await nestedModel.exists() && await nestedModel.length() > 1000000) return nested;

    if (voice.id != 'claude') return null;

    final docs = await getApplicationDocumentsDirectory();
    final flat = Directory('\${docs.path}/piper');
    final flatModel = File('\${flat.path}/\${voice.modelFile}');
    if (await flatModel.exists() && await flatModel.length() > 1000000) return flat;

    final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
    final keys = manifest.listAssets().where((key) => key.startsWith('assets/piper/')).toList();
    if (keys.isNotEmpty) {
      await nested.create(recursive: true);
      for (final key in keys) {
        final data = await rootBundle.load(key);
        final relative = key.substring('assets/piper/'.length);
        final out = File('\${nested.path}/$relative');
        await out.parent.create(recursive: true);
        final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
        await out.writeAsBytes(bytes, flush: true);
      }
      if (await nestedModel.exists()) return nested;
    }

    const download = '/storage/emulated/0/Download/vits-piper-es_MX-claude-high';
    final external = File('$download/\${voice.modelFile}');
    if (await external.exists()) return Directory(download);
    return null;
  }

  Uint8List _wav(Float32List samples, int sampleRate) {
    final data = ByteData(44 + samples.length * 2);
    void setString(int offset, String value) {
      for (var i = 0; i < value.length; i++) {
        data.setUint8(offset + i, value.codeUnitAt(i));
      }
    }

    setString(0, 'RIFF');
    data.setUint32(4, 36 + samples.length * 2, Endian.little);
    setString(8, 'WAVE');
    setString(12, 'fmt ');
    data.setUint32(16, 16, Endian.little);
    data.setUint16(20, 1, Endian.little);
    data.setUint16(22, 1, Endian.little);
    data.setUint32(24, sampleRate, Endian.little);
    data.setUint32(28, sampleRate * 2, Endian.little);
    data.setUint16(32, 2, Endian.little);
    data.setUint16(34, 16, Endian.little);
    setString(36, 'data');
    data.setUint32(40, samples.length * 2, Endian.little);
    for (var i = 0; i < samples.length; i++) {
      var sample = samples[i];
      if (sample > 1) sample = 1;
      if (sample < -1) sample = -1;
      data.setInt16(44 + i * 2, (sample * 32767).round(), Endian.little);
    }
    return data.buffer.asUint8List();
  }
}
`;
  }

  private static generateLocalStoreDart(): string {
    return `import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class PendingOp {
  final int id;
  final String entidad;
  final String endpoint;
  final String payload;
  final bool synced;
  final String createdAt;

  PendingOp({
    required this.id,
    required this.entidad,
    required this.endpoint,
    required this.payload,
    required this.synced,
    required this.createdAt,
  });

  factory PendingOp.fromRow(Map<String, Object?> row) {
    return PendingOp(
      id: row['id'] as int,
      entidad: row['entidad'] as String,
      endpoint: row['endpoint'] as String,
      payload: row['payload'] as String,
      synced: (row['synced'] as int) == 1,
      createdAt: row['created_at'] as String,
    );
  }
}

/// Cola local. La orden de voz se guarda aqui primero y solo despues se envia al backend.
class LocalStore {
  static Database? _db;

  static Future<Database> _open() async {
    if (_db != null) return _db!;
    final path = p.join(await getDatabasesPath(), 'classforge_local.db');
    _db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE pending_ops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entidad TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            payload TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          )
        ''');
      },
    );
    return _db!;
  }

  static Future<int> insert({
    required String entidad,
    required String endpoint,
    required String payload,
  }) async {
    final db = await _open();
    return db.insert('pending_ops', {
      'entidad': entidad,
      'endpoint': endpoint,
      'payload': payload,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  static Future<List<PendingOp>> pending() async {
    final db = await _open();
    final rows = await db.query('pending_ops', where: 'synced = 0', orderBy: 'id DESC');
    return rows.map(PendingOp.fromRow).toList();
  }

  static Future<void> remove(int id) async {
    final db = await _open();
    await db.delete('pending_ops', where: 'id = ?', whereArgs: [id]);
  }

  static Future<void> markSynced(int id) async {
    final db = await _open();
    await db.update('pending_ops', {'synced': 1}, where: 'id = ?', whereArgs: [id]);
  }
}
`;
  }

  private static generateLocalAiServiceDart(): string {
    return `import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_gemma/flutter_gemma.dart';
import 'package:path_provider/path_provider.dart';

class FieldAnswer {
  final bool cancel;
  final bool skip;
  final Object? value;

  const FieldAnswer({this.cancel = false, this.skip = false, this.value});

  bool get empty => !cancel && !skip && (value == null || value.toString().trim().isEmpty);
}

class RegistrationDraft {
  final VoiceCommand command;
  final List<Map<String, dynamic>> faltan;

  const RegistrationDraft({required this.command, required this.faltan});
}

class VoiceCommand {
  final String accion;
  final String entidad;
  final String endpoint;
  final Map<String, dynamic> datos;

  VoiceCommand({
    required this.accion,
    required this.entidad,
    required this.endpoint,
    required this.datos,
  });
}

/// Gemma 3 1B en el telefono. No conversa: convierte una frase en una orden JSON
/// usando las clases del diagrama que ClassForge dejo en assets/schema_context.json.
class LocalAiService {
  static const String _modelFileName = 'Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm';
  static const String _modelUrl =
      'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm';
  static const String _phoneDownloadPath =
      '/storage/emulated/0/Download/Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm';

  dynamic _model;
  dynamic _chat;
  String? _schemaContext;

  Future<void> _loadSchemaContext() async {
    if (_schemaContext != null) return;
    _schemaContext = await rootBundle.loadString('assets/schema_context.json');
  }

  /// Copia Gemma una vez a la carpeta privada de la app. Las siguientes
  /// aperturas usan esa copia y no vuelven a pedir el archivo.
  Future<String?> _modelOnDisk({
    String? pickedFilePath,
    void Function(double progress)? onProgress,
  }) async {
    final dir = await getApplicationDocumentsDirectory();
    final stored = File('\${dir.path}/\$_modelFileName');
    if (await stored.exists() && await stored.length() >= 500 * 1024 * 1024) {
      return stored.path;
    }

    String? sourcePath = pickedFilePath;
    if (sourcePath == null) {
      final download = File(_phoneDownloadPath);
      if (download.existsSync()) sourcePath = download.path;
    }
    if (sourcePath == null) return null;

    final source = File(sourcePath);
    if (!await source.exists()) return null;
    final total = await source.length();
    if (total < 500 * 1024 * 1024) return source.path;

    try {
      final part = File('\${stored.path}.part');
      if (await part.exists()) await part.delete();
      final output = part.openWrite();
      var copied = 0;
      await for (final chunk in source.openRead()) {
        output.add(chunk);
        copied += chunk.length;
        if (total > 0) onProgress?.call(copied * 100 / total);
      }
      await output.close();
      if (await stored.exists()) await stored.delete();
      await part.rename(stored.path);
      return stored.path;
    } catch (_) {
      return source.path;
    }
  }

  Future<void> ensureModelReady({
    void Function(double progress)? onProgress,
    String? hfToken,
    String? pickedFilePath,
  }) async {
    final localPath = await _modelOnDisk(
      pickedFilePath: pickedFilePath,
      onProgress: onProgress,
    );

    final installer = FlutterGemma.installModel(
      modelType: ModelType.gemmaIt,
      fileType: ModelFileType.litertlm,
    );
    if (localPath != null) {
      await installer.fromFile(localPath).install();
    } else {
      await installer
          .fromNetwork(_modelUrl, token: hfToken)
          .withProgress((progress) => onProgress?.call(progress.toDouble()))
          .install();
    }
    _model = await FlutterGemma.getActiveModel(
      maxTokens: 1024,
      preferredBackend: PreferredBackend.cpu,
    );
  }

  /// Lista corta para el prompt. El JSON completo no cabe en la ventana del modelo.
  String _promptSchema() {
    final schema = jsonDecode(_schemaContext!) as Map<String, dynamic>;
    final entidades = (schema['entidades'] as List<dynamic>? ?? const []);
    final lines = <String>[];
    for (final item in entidades) {
      if (item is! Map) continue;
      final nombre = (item['entidad'] ?? '').toString();
      if (nombre.isEmpty) continue;
      final campos = (item['atributos'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .where((a) => a['pk'] != true)
          .map((a) => (a['nombre'] ?? '').toString())
          .where((n) => n.isNotEmpty)
          .join(', ');
      lines.add(campos.isEmpty ? nombre : '\$nombre: \$campos');
    }
    return lines.join('\\n');
  }

  String _fold(String value) {
    const from = 'áéíóúüñ';
    const to = 'aeiouun';
    var out = value.toLowerCase();
    for (var i = 0; i < from.length; i++) {
      out = out.replaceAll(from[i], to[i]);
    }
    return out;
  }

  String _spaced(String name) {
    final spaced = name.replaceAllMapped(
      RegExp(r'([a-z0-9])([A-Z])'),
      (m) => '\${m[1]} \${m[2]}',
    );
    return _fold(spaced);
  }

  String _fieldBody(String nombre) {
    final spaced = _spaced(nombre);
    final names = <String>[spaced];
    if (spaced == 'email') {
      names.add('correo');
      names.add('mail');
    }
    return names.map(_flexible).join('|');
  }

  String _flexible(String spaced) {
    final parts = spaced.split(' ').where((part) => part.isNotEmpty).toList();
    final body = parts.map(RegExp.escape).join(r'(?:\\s+de)?\\s+');
    return '\\\\b\$body\\\\b';
  }

  List<Map<String, dynamic>> _entidades() {
    final schema = jsonDecode(_schemaContext!) as Map<String, dynamic>;
    return (schema['entidades'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  String _cleanValue(String raw, {Set<String> extra = const {}}) {
    const stop = {
      'registrar', 'registra', 'registro', 'guardar', 'guarda',
      'crear', 'crea', 'con', 'en', 'el', 'la', 'los', 'las',
      'un', 'una', 'de', 'del', 'para', 'y', 'a', 'al', 'que',
      'clase', 'tabla', 'entidad', 'campo', 'su', 'maese', 'mail',
      'correo', 'email', 'arroba', 'boliviano', 'bolivianos', 'bs',
    };
    final words = raw
        .split(RegExp(r'[^a-z0-9@.]+'))
        .where((word) => word.isNotEmpty && !stop.contains(word) && !extra.contains(word))
        .toList();
    if (words.length == 2 && words[0] == words[1]) return words[0];
    return words.join(' ').trim();
  }

  int? _spanishNumber(String text) {
    const values = <String, int>{
      'cero': 0, 'un': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4,
      'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9,
      'diez': 10, 'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14,
      'quince': 15, 'dieciseis': 16, 'diecisiete': 17, 'dieciocho': 18,
      'diecinueve': 19, 'veinte': 20, 'veintiuno': 21, 'veintidos': 22,
      'veintitres': 23, 'veinticuatro': 24, 'veinticinco': 25, 'veintiseis': 26,
      'veintisiete': 27, 'veintiocho': 28, 'veintinueve': 29, 'treinta': 30,
      'cuarenta': 40, 'cincuenta': 50, 'sesenta': 60, 'setenta': 70,
      'ochenta': 80, 'noventa': 90, 'cien': 100, 'ciento': 100,
      'doscientos': 200, 'trescientos': 300, 'cuatrocientos': 400,
      'quinientos': 500, 'seiscientos': 600, 'setecientos': 700,
      'ochocientos': 800, 'novecientos': 900,
    };
    var total = 0;
    var current = 0;
    var any = false;
    for (final word in text.split(RegExp(r'\\s+')).where((w) => w.isNotEmpty)) {
      if (word == 'y') continue;
      final direct = int.tryParse(word);
      if (direct != null) {
        current += direct;
        any = true;
        continue;
      }
      if (word == 'mil') {
        current = (current == 0 ? 1 : current) * 1000;
        total += current;
        current = 0;
        any = true;
        continue;
      }
      final value = values[word];
      if (value == null) continue;
      current += value;
      any = true;
    }
    if (!any) return null;
    return total + current;
  }

  String? _spanishDate(String text) {
    const months = <String, int>{
      'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
      'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9, 'octubre': 10,
      'noviembre': 11, 'diciembre': 12,
    };
    final words = text.split(RegExp(r'\\s+')).where((w) => w.isNotEmpty).toList();
    var monthIndex = -1;
    var month = 0;
    for (var i = 0; i < words.length; i++) {
      final found = months[words[i]];
      if (found != null) {
        month = found;
        monthIndex = i;
        break;
      }
    }
    if (monthIndex < 0) return null;
    final day = _spanishNumber(words.take(monthIndex).join(' '));
    final year = _spanishNumber(words.skip(monthIndex + 1).join(' '));
    if (day == null || year == null || day < 1 || day > 31 || year < 1900) return null;
    final mm = month < 10 ? '0\$month' : '\$month';
    final dd = day < 10 ? '0\$day' : '\$day';
    return '\$year-\$mm-\${dd}T00:00:00';
  }

  String? _emailFrom(String text) {
    final words = text.split(RegExp(r'\\s+')).where((w) => w.isNotEmpty).toList();
    final at = words.lastIndexOf('arroba');
    if (at <= 0 || at >= words.length - 1) return null;
    final local = words[at - 1];
    if (local == 'en' || local == 'el' || local == 'de') return null;
    var domain = words.sublist(at + 1).take(4).join(' ');
    domain = domain.replaceAll(' punto ', '.').replaceAll('punto', '.');
    domain = domain.split(' ').first;
    if (domain.isEmpty) return null;
    if (!domain.contains('.')) domain = '\$domain.com';
    return '\$local@\$domain';
  }

  VoiceCommand _polished(VoiceCommand command, String phrase) {
    Map<String, dynamic>? entidad;
    for (final item in _entidades()) {
      if ((item['entidad'] ?? '').toString() == command.entidad) {
        entidad = item;
        break;
      }
    }
    if (entidad == null) return command;
    final extra = _spaced(command.entidad).split(' ').where((w) => w.isNotEmpty).toSet();
    final atributos = (entidad['atributos'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    final datos = <String, dynamic>{};
    command.datos.forEach((key, value) {
      Map<String, dynamic>? attr;
      for (final item in atributos) {
        if ((item['nombre'] ?? '').toString() == key) {
          attr = item;
          break;
        }
      }
      final cleaned = _cleanValue(value.toString(), extra: extra);
      if (cleaned.isEmpty) return;
      final tipo = (attr?['tipo'] ?? '').toString().toLowerCase();
      if (tipo.contains('date')) {
        datos[key] = _spanishDate(cleaned) ?? cleaned;
      } else if (tipo.contains('int') || tipo.contains('double') || tipo.contains('long') || tipo.contains('float')) {
        final number = _spanishNumber(cleaned);
        datos[key] = number ?? cleaned;
      } else {
        datos[key] = cleaned;
      }
    });
    final email = _emailFrom(_fold(phrase));
    final hasEmail = atributos.any((item) => (item['nombre'] ?? '').toString().toLowerCase() == 'email');
    if (email != null && hasEmail) {
      datos['email'] = email;
      final nombre = datos['nombre'];
      if (nombre is String) {
        final local = email.split('@').first;
        final domain = email.split('@').last.split('.').first;
        final rest = _cleanValue(nombre, extra: {...extra, local, domain, 'gmail', 'hotmail', 'yahoo'});
        datos['nombre'] = rest.isEmpty ? local : rest;
      }
    }
    return VoiceCommand(
      accion: command.accion,
      entidad: command.entidad,
      endpoint: command.endpoint,
      datos: datos,
    );
  }

  Map<String, dynamic> _payloadFor(Map<String, dynamic> entidad, Map<String, dynamic> datos) {
    final atributos = (entidad['atributos'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    final payload = <String, dynamic>{};
    datos.forEach((key, value) {
      final wanted = _fold(key).replaceAll(RegExp(r'[^a-z0-9]'), '');
      Map<String, dynamic>? attr;
      for (final item in atributos) {
        final nombre = _fold((item['nombre'] ?? '').toString()).replaceAll(RegExp(r'[^a-z0-9]'), '');
        if (nombre == wanted) {
          attr = item;
          break;
        }
      }
      if (attr != null && attr['pk'] != true && value != null && value.toString().trim().isNotEmpty) {
        payload[attr['nombre'].toString()] = value.toString().trim();
      }
    });
    return payload;
  }

  VoiceCommand _toCommand(Map<String, dynamic> entidad, Map<String, dynamic> datos) {
    return VoiceCommand(
      accion: 'REGISTRAR',
      entidad: entidad['entidad'].toString(),
      endpoint: entidad['tabla'].toString(),
      datos: datos,
    );
  }

  VoiceCommand? _commandFromPhrase(String phrase, {bool allowLeftover = true}) {
    final folded = _fold(phrase);
    final entidades = _entidades()
      ..sort(
        (a, b) => _spaced((b['entidad'] ?? '').toString())
            .length
            .compareTo(_spaced((a['entidad'] ?? '').toString()).length),
      );
    Map<String, dynamic>? entidad;
    for (final item in entidades) {
      final pattern = RegExp(_flexible(_spaced((item['entidad'] ?? '').toString())));
      if (pattern.hasMatch(folded)) {
        entidad = item;
        break;
      }
    }
    if (entidad == null) return null;

    final atributos = (entidad['atributos'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .where((item) => item['pk'] != true)
        .toList();
    final payload = <String, dynamic>{};
    for (final attr in atributos) {
      final pattern = RegExp(_fieldBody((attr['nombre'] ?? '').toString()));
      final match = pattern.firstMatch(folded);
      if (match == null) continue;
      final after = folded.substring(match.end);
      var cut = after.length;
      for (final other in atributos) {
        if (other['nombre'] == attr['nombre']) continue;
        final otherMatch = RegExp(_fieldBody((other['nombre'] ?? '').toString())).firstMatch(after);
        if (otherMatch != null && otherMatch.start < cut) cut = otherMatch.start;
      }
      final value = _cleanValue(after.substring(0, cut));
      if (value.isNotEmpty) payload[attr['nombre'].toString()] = value;
    }

    if (allowLeftover && payload.isEmpty) {
      Map<String, dynamic>? firstText;
      for (final attr in atributos) {
        final tipo = (attr['tipo'] ?? '').toString().toLowerCase();
        if (tipo.contains('string')) {
          firstText = attr;
          break;
        }
      }
      firstText ??= atributos.isEmpty ? null : atributos.first;
      if (firstText != null) {
        final leftover = _cleanValue(
          folded.replaceAll(RegExp(_flexible(_spaced(entidad['entidad'].toString()))), ' '),
        );
        if (leftover.isNotEmpty) payload[firstText['nombre'].toString()] = leftover;
      }
    }

    return _toCommand(entidad, payload);
  }

  VoiceCommand? _commandFromModel(String raw) {
    final match = RegExp(r'\\{[\\s\\S]*\\}').firstMatch(raw);
    if (match == null) return null;
    final body = match.group(0)!;
    dynamic decoded;
    try {
      decoded = jsonDecode(body);
    } catch (_) {
      try {
        decoded = jsonDecode(body.replaceAll("'", '"'));
      } catch (_) {
        return null;
      }
    }
    if (decoded is! Map) return null;
    final accion = (decoded['accion'] ?? '').toString().toUpperCase();
    if (accion != 'REGISTRAR') return null;
    final wanted = _fold((decoded['entidad'] ?? '').toString()).replaceAll(RegExp(r'[^a-z0-9]'), '');
    Map<String, dynamic>? entidad;
    for (final item in _entidades()) {
      final nombre = _fold((item['entidad'] ?? '').toString()).replaceAll(RegExp(r'[^a-z0-9]'), '');
      if (nombre == wanted) {
        entidad = item;
        break;
      }
    }
    if (entidad == null) return null;
    final datosRaw = decoded['datos'];
    final datos = datosRaw is Map ? Map<String, dynamic>.from(datosRaw) : <String, dynamic>{};
    return _toCommand(entidad, _payloadFor(entidad, datos));
  }

  String _modelText(Object response) {
    if (response is TextResponse) return response.token;
    return response.toString();
  }

  Future<void> _ensureChat() async {
    if (_chat != null) return;
    await _loadSchemaContext();
    _model = await FlutterGemma.getActiveModel(
      maxTokens: 1024,
      preferredBackend: PreferredBackend.cpu,
    );
    final esquema = _promptSchema();
    _chat = await _model.createChat(
      temperature: 0.2,
      topK: 1,
      maxOutputTokens: 160,
      systemInstruction: 'Convierte la frase en JSON, sin markdown. '
          'Ejemplo: {"accion":"REGISTRAR","entidad":"Producto","datos":{"nombre":"bebidas"}}. '
          'Usa solo una clase y sus campos de esta lista:\\n\$esquema\\n'
          'No inventes la clase Clase.',
    );
  }

  bool _onlyWords(String folded, Set<String> words) {
    final parts = folded.split(RegExp(r'[^a-z0-9]+')).where((word) => word.isNotEmpty).toList();
    return parts.isNotEmpty && parts.every(words.contains);
  }

  String _camel(String name) {
    if (name.isEmpty) return name;
    return name.substring(0, 1).toLowerCase() + name.substring(1);
  }

  List<Map<String, dynamic>> _campos(Map<String, dynamic> entidad) {
    return (entidad['atributos'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .where((item) => item['pk'] != true)
        .toList();
  }

  List<Map<String, dynamic>> _enlaces(Map<String, dynamic> entidad) {
    final rels = (entidad['relaciones'] as List<dynamic>? ?? const []);
    final out = <Map<String, dynamic>>[];
    for (final raw in rels) {
      if (raw is! Map) continue;
      if ((raw['tipo'] ?? '').toString() != 'MANY_TO_ONE') continue;
      final hacia = (raw['hacia'] ?? '').toString();
      if (hacia.isEmpty) continue;
      final campo = (raw['campo'] ?? _camel(hacia)).toString();
      String tabla = '';
      for (final item in _entidades()) {
        if ((item['entidad'] ?? '').toString() == hacia) {
          tabla = (item['tabla'] ?? '').toString();
          break;
        }
      }
      out.add({
        'nombre': campo,
        'tipo': 'relacion',
        'hacia': hacia,
        'tabla': tabla,
      });
    }
    return out;
  }

  String labelFor(Map<String, dynamic> attr) {
    if ((attr['tipo'] ?? '').toString() == 'relacion') {
      return _spaced((attr['hacia'] ?? attr['nombre'] ?? '').toString());
    }
    final nombre = (attr['nombre'] ?? '').toString();
    if (_spaced(nombre) == 'email') return 'correo';
    return _spaced(nombre);
  }

  String questionFor(Map<String, dynamic> attr) {
    if ((attr['tipo'] ?? '').toString() == 'relacion') {
      return '¿A que \${labelFor(attr)} pertenece? Di el nombre.';
    }
    return '¿Cual es el \${labelFor(attr)}?';
  }

  Future<int> rankOf(String entidad) async {
    await _loadSchemaContext();
    for (final item in _entidades()) {
      if ((item['entidad'] ?? '').toString() == entidad) return _enlaces(item).length;
    }
    return 0;
  }

  void rememberSaved(Map<String, Map<String, int>> known, String entidad, Object? body) {
    if (body is! Map) return;
    final id = body['id'];
    final nombre = body['nombre'];
    if (id is! num || nombre == null) return;
    known.putIfAbsent(entidad, () => {})[_fold(nombre.toString())] = id.toInt();
  }

  Future<String> resolvePayload(
    String entidad,
    String payload,
    Future<List<dynamic>> Function(String tabla) fetch,
    Map<String, Map<String, int>> known,
  ) async {
    await _loadSchemaContext();
    final datos = jsonDecode(payload);
    if (datos is! Map) return payload;
    Map<String, dynamic>? entity;
    for (final item in _entidades()) {
      if ((item['entidad'] ?? '').toString() == entidad) {
        entity = item;
        break;
      }
    }
    if (entity == null) return payload;
    for (final link in _enlaces(entity)) {
      final campo = (link['nombre'] ?? '').toString();
      final value = datos[campo];
      if (value == null) continue;
      if (value is Map && value['id'] != null) {
        datos[campo] = {'id': value['id']};
        continue;
      }
      final spoken = value is Map ? (value['nombre'] ?? '').toString() : value.toString();
      final wanted = _fold(spoken);
      if (wanted.isEmpty) continue;
      final hacia = (link['hacia'] ?? '').toString();
      final cached = known[hacia]?[wanted];
      if (cached != null) {
        datos[campo] = {'id': cached};
        continue;
      }
      final tabla = (link['tabla'] ?? '').toString();
      if (tabla.isEmpty) throw Exception('No hay tabla para \$hacia.');
      final rows = await fetch(tabla);
      num? found;
      for (final row in rows) {
        if (row is! Map) continue;
        final nombre = row['nombre'];
        if (nombre != null && _fold(nombre.toString()) == wanted && row['id'] is num) {
          found = row['id'] as num;
          break;
        }
      }
      if (found == null) {
        throw Exception('No encontre \$spoken en \$hacia. Creala y sincroniza antes.');
      }
      known.putIfAbsent(hacia, () => {})[wanted] = found.toInt();
      datos[campo] = {'id': found.toInt()};
    }
    return jsonEncode(datos);
  }

  /// Busca la clase en el diagrama y separa los datos que ya vinieron en la frase.
  /// No abre Gemma: los campos que falten se preguntan uno por uno.
  Future<RegistrationDraft?> prepareRegistration(String phrase) async {
    await _loadSchemaContext();
    final found = _commandFromPhrase(phrase, allowLeftover: false);
    if (found == null) return null;
    final command = _polished(found, phrase);
    Map<String, dynamic>? entidad;
    for (final item in _entidades()) {
      if ((item['entidad'] ?? '').toString() == command.entidad) {
        entidad = item;
        break;
      }
    }
    if (entidad == null) return null;
    final faltan = [
      ..._campos(entidad),
      ..._enlaces(entidad),
    ].where((attr) => !command.datos.containsKey((attr['nombre'] ?? '').toString())).toList();
    return RegistrationDraft(command: command, faltan: faltan);
  }

  FieldAnswer answerFor(Map<String, dynamic> attr, String phrase, String entidad) {
    final folded = _fold(phrase);
    if (_onlyWords(folded, const {'cancelar', 'cancela', 'cancelado', 'abortar'})) {
      return const FieldAnswer(cancel: true);
    }
    if (_onlyWords(folded, const {'saltar', 'salta', 'omitir', 'omite', 'pasar', 'ninguno', 'ninguna', 'nada'})) {
      return const FieldAnswer(skip: true);
    }
    final nombre = (attr['nombre'] ?? '').toString();
    final tipo = (attr['tipo'] ?? '').toString().toLowerCase();
    final extra = _spaced(entidad).split(' ').where((word) => word.isNotEmpty).toSet();
    if (tipo == 'relacion') {
      final cleaned = _cleanValue(folded, extra: extra);
      if (cleaned.isEmpty) return const FieldAnswer();
      final asNumber = int.tryParse(cleaned);
      if (asNumber != null) return FieldAnswer(value: {'id': asNumber});
      return FieldAnswer(value: {'nombre': cleaned});
    }
    if (nombre.toLowerCase() == 'email') {
      final email = _emailFrom(folded);
      if (email != null) return FieldAnswer(value: email);
    }
    final cleaned = _cleanValue(folded, extra: extra);
    if (cleaned.isEmpty) return const FieldAnswer();
    if (tipo.contains('date')) {
      return FieldAnswer(value: _spanishDate(cleaned) ?? cleaned);
    }
    if (tipo.contains('int') || tipo.contains('double') || tipo.contains('long') || tipo.contains('float')) {
      return FieldAnswer(value: _spanishNumber(cleaned) ?? cleaned);
    }
    return FieldAnswer(value: cleaned);
  }

  Future<VoiceCommand> interpret(String phrase) async {
    await _loadSchemaContext();
    _chat = null;
    await _ensureChat();
    await _chat.addQueryChunk(Message.text(text: phrase, isUser: true));
    final response = await _chat.generateChatResponse();
    final fromModel = _commandFromModel(_modelText(response));
    final fromPhrase = _commandFromPhrase(phrase);
    final chosen = (fromPhrase != null && fromPhrase.datos.isNotEmpty)
        ? fromPhrase
        : (fromModel != null && fromModel.datos.isNotEmpty)
            ? fromModel
            : fromPhrase ?? fromModel;
    if (chosen != null) return _polished(chosen, phrase);
    throw Exception('No entendi la orden. Di: registrar producto con nombre bebidas.');
  }

  Future<void> dispose() async {
    try {
      await _model?.close();
    } catch (_) {}
  }
}
`;
  }

  private static generateAiChatScreenDart(projectName: string): string {
    return `import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:vosk_flutter_2/vosk_flutter_2.dart';

import '../config/api_config.dart';
import '../services/local_ai_service.dart';
import '../services/local_store.dart';
import '../services/piper_voice.dart';
import 'package:http/http.dart' as http;

/// Pantalla de voz. Vosk oye sin internet, Gemma arma la orden y SQLite la guarda.
class AiChatScreen extends StatefulWidget {
  const AiChatScreen({super.key});

  @override
  State<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends State<AiChatScreen> with WidgetsBindingObserver {
  final LocalAiService _ai = LocalAiService();
  final FlutterTts _tts = FlutterTts();
  final PiperVoice _piper = PiperVoice();
  final List<PendingOp> _pending = [];

  SpeechService? _speech;
  StreamSubscription<String>? _partialSub;
  StreamSubscription<String>? _resultSub;
  final TextEditingController _phrase = TextEditingController();
  String _status = 'Preparando la voz y el modelo...';
  bool _modelReady = false;
  bool _listening = false;
  bool _busy = false;
  bool _downloading = false;
  double _downloadProgress = 0;
  bool? _online;
  bool _preferPiper = true;
  String _voiceName = 'telefono';
  final Set<String> _installedVoices = {};
  bool _live = false;
  bool _speaking = false;
  bool _turn = false;
  VoiceCommand? _draft;
  List<Map<String, dynamic>> _asks = [];
  int _askIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _tts.awaitSpeakCompletion(true);
    _tuneVoice();
    _checkNetwork();
    _prepare();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _checkNetwork();
  }

  Future<void> _tuneVoice() async {
    await _tts.setLanguage('es-MX');
    await _tts.setSpeechRate(0.42);
    await _tts.setPitch(1.0);
    try {
      final voices = await _tts.getVoices;
      if (voices is! List) return;
      Map? best;
      var bestScore = -1;
      for (final raw in voices) {
        if (raw is! Map) continue;
        final locale = (raw['locale'] ?? '').toString().toLowerCase();
        final name = (raw['name'] ?? '').toString().toLowerCase();
        if (!locale.startsWith('es')) continue;
        var score = 1;
        if (locale.startsWith('es-mx') || locale.startsWith('es-us') || locale.contains('419')) score += 5;
        if (locale.startsWith('es-es')) score += 1;
        if (name.contains('local')) score += 4;
        if (name.contains('network')) score += 1;
        if (name.contains('sfb') || name.contains('studio') || name.contains('neural')) score += 3;
        if (score > bestScore) {
          bestScore = score;
          best = raw;
        }
      }
      if (best == null) return;
      await _tts.setVoice({
        'name': best['name'].toString(),
        'locale': best['locale'].toString(),
      });
    } catch (_) {}
  }

  Future<void> _checkNetwork() async {
    var online = false;
    try {
      final result = await InternetAddress.lookup('example.com').timeout(const Duration(seconds: 3));
      online = result.isNotEmpty && result.first.rawAddress.isNotEmpty;
    } catch (_) {
      online = false;
    }
    if (!mounted) return;
    setState(() => _online = online);
  }

  Future<void> _prepare() async {
    await _reloadPending();
    try {
      final mic = await Permission.microphone.request();
      if (!mic.isGranted) {
        setState(() => _status = 'Sin permiso de microfono no puedo oir.');
        return;
      }
      final vosk = VoskFlutterPlugin.instance();
      final modelPath = await ModelLoader().loadFromAssets('assets/models/vosk-model-small-es-0.42.zip');
      final model = await vosk.createModel(modelPath);
      final recognizer = await vosk.createRecognizer(model: model, sampleRate: 16000);
      _speech = await vosk.initSpeechService(recognizer);
      _partialSub = _speech!.onPartial().listen((raw) {
        final text = _textFromVosk(raw);
        if (text.isEmpty || !mounted) return;
        setState(() => _showHeard(text));
      });
      _resultSub = _speech!.onResult().listen((raw) {
        final text = _textFromVosk(raw);
        if (text.isEmpty || !mounted) return;
        setState(() => _showHeard(text));
        if (_live && !_speaking && !_busy) {
          _takeTurn(text);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'No pude cargar el modelo de voz. Copia vosk-model-small-es-0.42.zip dentro de assets/models. Detalle: \$e');
      return;
    }

    setState(() => _status = 'Preparando la voz...');
    final ready = await _piper.prepare();
    final installed = await _piper.installedIds();
    if (mounted) {
      setState(() {
        _installedVoices
          ..clear()
          ..addAll(installed);
        _voiceName = ready ? _piper.label : 'telefono';
        _preferPiper = ready;
      });
    }

    setState(() => _downloading = true);
    const hfToken = String.fromEnvironment('HF_TOKEN');
    try {
      await _ai.ensureModelReady(
        onProgress: (p) {
          if (mounted) setState(() => _downloadProgress = p);
        },
        hfToken: hfToken.isEmpty ? null : hfToken,
      );
      if (!mounted) return;
      setState(() {
        _modelReady = true;
        _downloading = false;
        _status = 'Toca la bola y di que quieres registrar.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _status = 'Gemma no esta en el telefono. Elige el archivo .litertlm o descarga con HF_TOKEN. Detalle: \$e';
      });
    }
  }

  String _textFromVosk(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        final text = decoded['text'] ?? decoded['partial'];
        if (text is String) return text.trim();
      }
    } catch (_) {}
    return raw.trim();
  }

  Future<void> _reloadPending() async {
    final rows = await LocalStore.pending();
    if (!mounted) return;
    setState(() {
      _pending
        ..clear()
        ..addAll(rows);
    });
  }

  void _showHeard(String text) {
    _phrase.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }

  Future<void> _toggleBall() async {
    final speech = _speech;
    if (speech == null || _busy) return;
    if (_live) {
      _live = false;
      await speech.stop();
      await _tts.stop();
      await _piper.stop();
      if (!mounted) return;
      setState(() {
        _listening = false;
        _speaking = false;
        _status = 'Toca la bola y di que quieres registrar.';
      });
      return;
    }
    setState(() {
      _live = true;
      _status = 'Hablando...';
      _phrase.clear();
    });
    await _startEar();
  }

  Future<void> _startEar() async {
    final speech = _speech;
    if (speech == null || !_live || _speaking || _listening) return;
    setState(() {
      _listening = true;
      _phrase.clear();
      _status = 'Hablando...';
    });
    await speech.start();
  }

  Future<void> _speak(String text) async {
    var used = 'telefono';
    if (_preferPiper) {
      try {
        if (_piper.isReady && await _piper.speak(text)) {
          used = _piper.label;
        } else {
          _piper.failure ??= '\${_piper.label} no esta lista. Eligela en el menu para descargarla.';
        }
      } catch (e) {
        _piper.failure = '\${_piper.label} no pudo hablar: \$e';
      }
    }
    if (used == 'telefono') {
      await _tts.speak(text);
    }
    if (mounted) setState(() => _voiceName = used);
  }

  Future<void> _chooseVoice(SpanishVoice voice) async {
    setState(() {
      _preferPiper = true;
      _busy = true;
      _downloading = false;
      _status = 'Abriendo \${voice.label}...';
    });
    var ok = await _piper.use(voice);
    if (!ok && mounted) {
      setState(() {
        _downloading = true;
        _downloadProgress = 0;
        _status = 'Descargando \${voice.label} (\${voice.megabytes} MB)...';
      });
      ok = await _piper.use(voice, onProgress: (percent) {
        if (!mounted) return;
        setState(() {
          if (percent < 0) {
            _downloadProgress = 0;
            _status = percent < -1
                ? 'Abriendo \${voice.label}...'
                : 'Instalando \${voice.label}. La barra sigue moviendose.';
          } else {
            _downloadProgress = percent;
            _status = 'Descargando \${voice.label} (\${voice.megabytes} MB)...';
          }
        });
      });
    }
    final installed = await _piper.installedIds();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _downloading = false;
      _installedVoices
        ..clear()
        ..addAll(installed);
      _voiceName = ok ? voice.label : 'telefono';
      _preferPiper = ok;
      _status = ok ? 'Voz \${voice.label} lista.' : 'Sigue la voz del telefono.';
    });
  }

  Future<void> _say(String text, {bool listenAfter = true}) async {
    if (!mounted) return;
    await _speech?.stop();
    setState(() {
      _listening = false;
      _speaking = true;
      _status = text;
      _phrase.clear();
    });
    await _speak(text);
    if (!mounted) return;
    setState(() => _speaking = false);
    if (_live && listenAfter) {
      await Future.delayed(const Duration(milliseconds: 400));
      await _startEar();
    }
  }

  Future<void> _takeTurn(String phrase) async {
    final text = phrase.trim();
    if (text.isEmpty || _busy || _speaking || _turn) return;
    _turn = true;
    try {
      if (_listening) await _speech?.stop();
      if (!mounted) return;
      setState(() => _listening = false);
      if (_draft != null) {
        await _answerCurrent(text);
        return;
      }
      await _register(text);
    } finally {
      _turn = false;
    }
  }

  Future<void> _sendTyped() async {
    final phrase = _phrase.text.trim();
    if (phrase.isEmpty || _busy || _speaking) return;
    if (!_live) setState(() => _live = true);
    await _takeTurn(phrase);
  }

  void _clearDraft() {
    _draft = null;
    _asks = [];
    _askIndex = 0;
  }

  Future<void> _askCurrent() async {
    if (_draft == null || _askIndex >= _asks.length) return;
    final question = _ai.questionFor(_asks[_askIndex]);
    final intro = _askIndex == 0 ? 'Esta bien. \$question' : question;
    await _say(intro);
  }

  Future<void> _answerCurrent(String phrase) async {
    final draft = _draft;
    if (draft == null || _askIndex >= _asks.length) return;
    final attr = _asks[_askIndex];
    final answer = _ai.answerFor(attr, phrase, draft.entidad);
    if (answer.cancel) {
      setState(() {
        _clearDraft();
        _live = false;
      });
      await _say('Cancele el registro.', listenAfter: false);
      return;
    }
    if (answer.empty) {
      await _say('No entendi ese dato. Repitelo, o di saltar.');
      return;
    }
    if (!answer.skip) {
      draft.datos[(attr['nombre'] ?? '').toString()] = answer.value;
    }
    setState(() => _askIndex += 1);
    if (_askIndex < _asks.length) {
      await _askCurrent();
      return;
    }
    final command = draft;
    setState(_clearDraft);
    await _finish(command);
  }

  Future<void> _register(String phrase) async {
    setState(() {
      _busy = true;
      _status = 'Buscando la clase...';
    });
    RegistrationDraft? draft;
    try {
      draft = await _ai.prepareRegistration(phrase);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'No pude leer las clases. \$e';
      });
      return;
    }
    if (!mounted) return;
    if (draft != null) {
      setState(() => _busy = false);
      if (draft.faltan.isEmpty) {
        await _finish(draft.command);
        return;
      }
      setState(() {
        _draft = draft!.command;
        _asks = draft.faltan;
        _askIndex = 0;
      });
      await _askCurrent();
      return;
    }

    if (!_modelReady) {
      setState(() => _busy = false);
      await _say('No encontre esa clase. Di registrar cliente.');
      return;
    }

    setState(() => _status = 'Interpretando...');
    late final VoiceCommand command;
    try {
      command = await _ai.interpret(phrase);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'No pude registrar esa orden. \$e';
      });
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);
    await _finish(command);
  }

  Future<void> _finish(VoiceCommand command) async {
    if (command.datos.isEmpty) {
      await _say('No entendi datos. Di registrar cliente.');
      return;
    }
    if (!_live) {
      await _confirmAndSave(command);
      return;
    }
    await _store(command);
    if (mounted) setState(() => _live = false);
  }

  Future<void> _store(VoiceCommand command) async {
    setState(() => _busy = true);
    try {
      await LocalStore.insert(
        entidad: command.entidad,
        endpoint: command.endpoint,
        payload: jsonEncode(command.datos),
      );
      await _reloadPending();
      final spoken = 'Guarde \${command.entidad} en el telefono.';
      setState(() => _phrase.clear());
      await _say(spoken, listenAfter: false);
    } catch (e) {
      if (!mounted) return;
      await _say('No pude guardar esa orden.', listenAfter: false);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmAndSave(VoiceCommand command) async {
    final preview = command.datos.entries.map((e) => '\${e.key}: \${_showValue(e.value)}').join('\\n');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(command.datos.isEmpty ? 'No entendi datos' : '¿Guardar \${command.entidad}?'),
        content: Text(
          command.datos.isEmpty
              ? 'La orden no tiene datos confiables. Corrigelo antes de guardar.'
              : preview,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Corregir')),
          if (command.datos.isNotEmpty)
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Guardar')),
        ],
      ),
    );
    if (accepted != true || !mounted) {
      setState(() => _status = 'No se guardo. Corrige el texto y pulsa Guardar.');
      return;
    }

    setState(() => _busy = true);
    try {
      await LocalStore.insert(
        entidad: command.entidad,
        endpoint: command.endpoint,
        payload: jsonEncode(command.datos),
      );
      await _reloadPending();
      final spoken = 'Guarde \${command.entidad} en el telefono.';
      setState(() {
        _status = spoken;
        _phrase.clear();
      });
      await _speak(spoken);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'No pude guardar esa orden. \$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discard(PendingOp op) async {
    await LocalStore.remove(op.id);
    await _reloadPending();
    if (!mounted) return;
    setState(() => _status = 'Quite \${op.entidad} de la lista. No se enviara.');
  }

  Future<void> _pickGemma() async {
    final result = await FilePicker.platform.pickFiles();
    final path = result?.files.single.path;
    if (path == null) return;
    setState(() {
      _downloading = true;
      _status = 'Copiando Gemma al telefono...';
    });
    try {
      await _ai.ensureModelReady(pickedFilePath: path);
      if (!mounted) return;
      setState(() {
        _modelReady = true;
        _downloading = false;
        _status = 'Toca la bola y di que quieres registrar.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _status = 'No pude instalar ese archivo. \$e';
      });
    }
  }

  String _showValue(Object? value) {
    if (value is Map) {
      final nombre = value['nombre'];
      if (nombre != null && nombre.toString().trim().isNotEmpty) return nombre.toString();
      final id = value['id'];
      if (id != null) return 'id \$id';
    }
    return value.toString();
  }

  Future<List<dynamic>> _fetchTable(String tabla) async {
    final res = await http.get(Uri.parse('\${ApiConfig.baseUrl}/\$tabla'));
    if (res.statusCode != 200) return const [];
    final decoded = jsonDecode(res.body);
    return decoded is List ? decoded : const [];
  }

  Future<void> _sync() async {
    setState(() => _busy = true);
    var sent = 0;
    var failed = 0;
    var detail = '';
    final rows = [...await LocalStore.pending()];
    final ranks = <String, int>{};
    for (final op in rows) {
      ranks[op.entidad] ??= await _ai.rankOf(op.entidad);
    }
    rows.sort((a, b) {
      final rank = ranks[a.entidad]!.compareTo(ranks[b.entidad]!);
      if (rank != 0) return rank;
      return a.id.compareTo(b.id);
    });
    final known = <String, Map<String, int>>{};
    for (final op in rows) {
      try {
        final body = await _ai.resolvePayload(op.entidad, op.payload, _fetchTable, known);
        final res = await http.post(
          Uri.parse('\${ApiConfig.baseUrl}/\${op.endpoint}'),
          headers: {'Content-Type': 'application/json'},
          body: body,
        );
        if (res.statusCode == 200 || res.statusCode == 201) {
          try {
            _ai.rememberSaved(known, op.entidad, jsonDecode(res.body));
          } catch (_) {}
          await LocalStore.markSynced(op.id);
          sent++;
        } else {
          failed++;
          detail = 'El servidor respondio \${res.statusCode}.';
        }
      } catch (e) {
        failed++;
        detail = '\$e';
      }
    }
    await _reloadPending();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = failed == 0
          ? 'Sincronice \$sent registro(s) con el servidor.'
          : 'Enviados: \$sent. Sin enviar: \$failed. \$detail';
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _partialSub?.cancel();
    _resultSub?.cancel();
    _speech?.dispose();
    _phrase.dispose();
    _ai.dispose();
    _tts.stop();
    _piper.stop();
    super.dispose();
  }

  Widget _voiceDrawer() {
    final internet = _online == false
        ? 'Sin internet'
        : _online == true
            ? 'Con internet'
            : 'Revisando la conexion';
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
          children: [
            const ListTile(
              title: Text('${projectName}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
              subtitle: Text('Toca la bola, di la clase y responde cada dato.'),
            ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text('Voz', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            ListTile(
              dense: true,
              title: Text('En uso: \$_voiceName'),
            ),
            for (final voice in PiperVoice.catalog)
              RadioListTile<String>(
                title: Text(voice.label),
                subtitle: Text(
                  _installedVoices.contains(voice.id)
                      ? '\${voice.place}. \${voice.kind}. Lista en el telefono.'
                      : '\${voice.place}. \${voice.kind}. Se descarga al elegirla, \${voice.megabytes} MB.',
                ),
                value: voice.id,
                groupValue: _preferPiper ? _piper.current.id : 'telefono',
                onChanged: _busy ? null : (_) => _chooseVoice(voice),
              ),
            RadioListTile<String>(
              title: const Text('Telefono'),
              subtitle: const Text('La voz que ya trae el celular.'),
              value: 'telefono',
              groupValue: _preferPiper ? _piper.current.id : 'telefono',
              onChanged: _busy
                  ? null
                  : (_) => setState(() {
                        _preferPiper = false;
                        _voiceName = 'telefono';
                      }),
            ),
            if (_piper.failure != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(_piper.failure!),
              ),
            const Divider(),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text('Estado', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            ListTile(
              leading: Icon(_online == false ? Icons.cloud_off : Icons.cloud_outlined),
              title: Text(internet),
              subtitle: const Text('Sin internet puedes registrar. Sincroniza cuando vuelva.'),
            ),
            ListTile(
              leading: Icon(_modelReady ? Icons.check_circle_outline : Icons.hourglass_empty),
              title: Text(_modelReady ? 'Gemma lista' : 'Gemma no esta lista'),
              subtitle: const Text('Interpreta la orden si la frase no alcanza.'),
            ),
            ListTile(
              leading: const Icon(Icons.save_outlined),
              title: Text('Guardados en el telefono: \${_pending.length}'),
              subtitle: const Text('Salen al servidor al pulsar Sincronizar.'),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: OutlinedButton(
                onPressed: _busy
                    ? null
                    : () {
                        Navigator.pop(context);
                        _pickGemma();
                      },
                child: const Text('Elegir archivo de Gemma'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${projectName}')),
      drawer: _voiceDrawer(),
      body: Column(
        children: [
          if (_online == false)
            const Material(
              color: Color(0xFFE8EAF6),
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Icon(Icons.cloud_off, size: 18),
                    SizedBox(width: 8),
                    Expanded(child: Text('Sin internet. Puedes seguir registrando en el telefono.')),
                  ],
                ),
              ),
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
              children: [
                if (_busy) ...[
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(child: Text(_status)),
              ],
            ),
            if (_busy) ...[
              const SizedBox(height: 8),
              const LinearProgressIndicator(),
            ],
            if (_downloading) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: _downloadProgress > 0 ? _downloadProgress / 100 : null),
            ],
            const SizedBox(height: 28),
            Center(
              child: GestureDetector(
                onTap: _speech != null && !_busy ? _toggleBall : null,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  width: _listening ? 196 : 168,
                  height: _listening ? 196 : 168,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      center: const Alignment(-0.25, -0.35),
                      radius: 0.9,
                      colors: _listening
                          ? const [Color(0xFFD6FF6A), Color(0xFF3DDCFF), Color(0xFF1A5CFF)]
                          : _speaking
                              ? const [Color(0xFFFFE7A0), Color(0xFF7AD0FF), Color(0xFF245BFF)]
                              : const [Color(0xFFD7F5A8), Color(0xFF8FE0FF), Color(0xFF4C7DFF)],
                    ),
                    boxShadow: const [
                      BoxShadow(color: Color(0x553D7DFF), blurRadius: 28, spreadRadius: 2),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Center(child: Text(_listening ? 'Hablando...' : _speaking ? 'Te respondo...' : 'Toca para hablar')),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _phrase,
                    enabled: !_busy && !_speaking,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'O escribe un mensaje...',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(28)),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: !_busy && !_speaking && _phrase.text.trim().isNotEmpty ? _sendTyped : null,
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _modelReady || _busy ? null : _pickGemma,
              child: const Text('Elegir archivo de Gemma'),
            ),
            const SizedBox(height: 8),
            FilledButton.tonal(
              onPressed: _busy ? null : _sync,
              child: const Text('Sincronizar con el servidor'),
            ),
            const SizedBox(height: 16),
            Text('Guardados en el telefono: \${_pending.length}'),
            const SizedBox(height: 8),
            for (final op in _pending)
              ListTile(
                title: Text(op.entidad),
                subtitle: Text(op.payload),
                trailing: IconButton(
                  tooltip: 'Quitar',
                  onPressed: _busy ? null : () => _discard(op),
                  icon: const Icon(Icons.delete_outline),
                ),
              ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
`;
  }
  // ---------------------------------------------------------------------
  // main.dart (navegación entre pantallas de entidades + agente IA)
  // ---------------------------------------------------------------------

  private static generateMainDart(entities: any[], projectName: string): string {
    const crudEntities = entities.filter((e) => !e.isInterfaceStereotype);

    const imports = crudEntities
      .map((e) => `import 'screens/${this.toDartFileName(e.className)}_list_screen.dart';`)
      .join('\n');

    const classTiles = crudEntities
      .map((e) => `          ListTile(
            leading: const Icon(Icons.table_rows_outlined),
            title: const Text('${e.className}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => onOpen(const ${e.className}ListScreen()),
          ),`)
      .join('\n');

    return `import 'package:flutter/material.dart';
import 'package:flutter_gemma/flutter_gemma.dart';
import 'package:flutter_gemma_litertlm/flutter_gemma_litertlm.dart';
import 'screens/ai_chat_screen.dart';
${imports}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Registra el motor de inferencia on-device de flutter_gemma antes de correr la app.
  await FlutterGemma.initialize(inferenceEngines: const [LiteRtLmEngine()]);
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${projectName}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  void _openClass(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: [
          const AiChatScreen(),
          ClassMenu(onOpen: _openClass),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.mic_none), label: 'Voz'),
          NavigationDestination(icon: Icon(Icons.table_rows_outlined), label: 'Clases'),
        ],
      ),
    );
  }
}

class ClassMenu extends StatelessWidget {
  final void Function(Widget screen) onOpen;

  const ClassMenu({super.key, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Clases')),
      body: ListView(
        children: [
${classTiles}
        ],
      ),
    );
  }
}
`;
  }

  // ---------------------------------------------------------------------
  // Contexto del esquema para el LLM local + README
  // ---------------------------------------------------------------------

  private static generateSchemaContextJson(entities: any[], projectName: string): string {
    const summary = entities
      .filter((e) => !e.isInterfaceStereotype)
      .map((e) => ({
        entidad: e.className,
        tabla: e.tableName,
        atributos: (e.attributes || []).map((a: any) => ({ nombre: a.name, tipo: a.type, pk: !!a.isPrimaryKey })),
        relaciones: (e.relationships || []).map((r: any) => ({ tipo: r.type, hacia: r.targetEntity, campo: r.fieldName })),
        heredaDe: e.parentClass || null,
        implementa: e.implementsInterfaces || [],
      }));

    return JSON.stringify({ proyecto: projectName, entidades: summary }, null, 2);
  }

  private static generateReadme(projectName: string): string {
    return `# ${projectName} — App Flutter (generada por ClassForge)

Esta carpeta fue generada automaticamente a partir del diagrama UML junto con el backend
Spring Boot que esta en \`../backend\`. Trae pantallas CRUD por cada clase del diagrama y un
agente de chat + voz con **IA local on-device** (Gemma via \`flutter_gemma\`, sin depender de
ninguna API en la nube en tiempo de ejecucion).

## 1. Requisitos

- Flutter SDK instalado y en el PATH (\`flutter doctor\` sin errores bloqueantes).
- Un emulador/dispositivo Android o iOS, o soporte desktop/web habilitado.
- El backend Spring Boot de \`../backend\` corriendo (ver su propio README/pom.xml).

## 2. Generar las carpetas nativas (una sola vez)

Este generador solo entrega \`lib/\`, \`pubspec.yaml\`, \`assets/\` y config — **no** las carpetas
nativas \`android/\`, \`ios/\`, \`web/\`, etc. (son cientos de archivos de boilerplate que Flutter
sabe generar mejor que nosotros). La primera vez, desde dentro de esta carpeta corre:

\`\`\`
flutter create --platforms=android,ios,web .
\`\`\`

Esto detecta que ya existe un proyecto (por el \`pubspec.yaml\`) y solo agrega las carpetas
nativas faltantes, sin tocar \`lib/\` ni tu \`pubspec.yaml\`.

## 3. Configurar la URL del backend

Edita \`lib/config/api_config.dart\` y ajusta \`baseUrl\` segun donde corra tu backend:
- Emulador Android: \`http://10.0.2.2:8080/api/v1\` (ya viene asi por defecto).
- iOS Simulator / desktop: \`http://localhost:8080/api/v1\`.
- Dispositivo fisico: la IP real de tu maquina en la red local.

## 4. Voz sin internet

La primera pestaña oye con Vosk, interpreta la frase con Gemma 3 1B y guarda el registro en SQLite.
El botón **Sincronizar con el servidor** envía lo pendiente a \`ApiConfig.baseUrl\`.

1. Copia \`vosk-model-small-es-0.42.zip\` a \`assets/models/\` si el zip generado no lo trajo.
2. Después de \`flutter create\`, abre \`android/app/src/main/AndroidManifest.xml\` y, dentro de \`<manifest>\`, agrega:

   \`\`\`xml
   <uses-permission android:name="android.permission.RECORD_AUDIO"/>
   \`\`\`

3. Pasa el archivo de Gemma al teléfono (carpeta Download) o elige el \`.litertlm\` la primera vez, con Wi-Fi. Después de instalarlo, la voz funciona en modo avión.
4. En un teléfono físico cambia \`lib/config/api_config.dart\` a la IP de tu computadora, por ejemplo \`http://192.168.1.20:8080/api/v1\`.

## 5. Ejecutar

\`\`\`
flutter pub get
flutter run -d 5d53339f
\`\`\`

## Limitaciones conocidas (alcance de esta primera version generada)

- Las pantallas CRUD solo editan los **atributos escalares** de cada clase (no las
  relaciones @ManyToOne/@OneToMany/@ManyToMany del diagrama); esas se sirven en el JSON del
  backend pero esta version de la app no las presenta en el formulario todavia.
- Las Clases de Asociacion (claves compuestas) usan un solo campo como identificador para
  editar/eliminar, igual que el backend generado (limitacion compartida, no es un bug nuevo
  de la app).
- flutter_gemma es un paquete en evolucion activa: si al compilar aparece un error de tipos
  en \`lib/services/local_ai_service.dart\`, revisa la version instalada en
  https://pub.dev/packages/flutter_gemma y ajusta esa clase segun su API actual — el resto
  de la app solo depende de \`LocalAiService.ask()\`/\`ensureModelReady()\`, no de los tipos
  internos del paquete.
`;
  }

  // ---------------------------------------------------------------------
  // Punto de entrada: ensambla todo dentro de una carpeta del zip ya abierto
  // ---------------------------------------------------------------------

  public static addFlutterAppToZip(parentFolder: JSZip, folderName: string, entities: any[], projectName: string): void {
    const voskPath = this.findVoskModel();
    const root = parentFolder.folder(folderName)!;
    root.file('pubspec.yaml', this.generatePubspecYaml(projectName, voskPath != null));
    root.file('analysis_options.yaml', this.generateAnalysisOptions());
    root.file('README.md', this.generateReadme(projectName));

    const lib = root.folder('lib')!;
    lib.file('main.dart', this.generateMainDart(entities, projectName));

    const configFolder = lib.folder('config')!;
    configFolder.file('api_config.dart', this.generateApiConfigDart());

    const modelsFolder = lib.folder('models')!;
    const screensFolder = lib.folder('screens')!;
    const servicesFolder = lib.folder('services')!;

    const crudEntities = entities.filter((e) => !e.isInterfaceStereotype);
    const byClassName = new Map(entities.map((e) => [e.className, e]));
    // Modelo/pantalla Flutter usan los atributos "efectivos" (propios + heredados), no
    // ent.attributes crudo, porque una clase hija de herencia no trae su PK en sus propios
    // attributes (la hereda de la raíz) aunque el JSON del backend sí la incluya.
    crudEntities.forEach((ent) => {
      const fileBase = this.toDartFileName(ent.className);
      const flatEnt = { ...ent, attributes: this.getEffectiveAttributes(ent, byClassName) };
      modelsFolder.file(`${fileBase}.dart`, this.generateModelDart(flatEnt));
      screensFolder.file(`${fileBase}_list_screen.dart`, this.generateListScreenDart(flatEnt));
    });

    servicesFolder.file('api_service.dart', this.generateApiServiceDart(crudEntities));
    servicesFolder.file('local_store.dart', this.generateLocalStoreDart());
    servicesFolder.file('local_ai_service.dart', this.generateLocalAiServiceDart());
    servicesFolder.file('piper_voice.dart', this.generatePiperVoiceDart());
    screensFolder.file('ai_chat_screen.dart', this.generateAiChatScreenDart(projectName));

    const assetsFolder = root.folder('assets')!;
    assetsFolder.file('schema_context.json', this.generateSchemaContextJson(entities, projectName));
    if (voskPath) {
      assetsFolder.folder('models')!.file(
        'vosk-model-small-es-0.42.zip',
        fs.readFileSync(voskPath),
        { compression: 'STORE' }
      );
    }
  }

  private static findVoskModel(): string | null {
    const candidates = [
      'D:\\modelos-examen\\vosk-model-small-es-0.42.zip',
      'C:\\Users\\EVELYN\\Downloads\\Compressed\\vosk-model-small-es-0.42.zip',
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
}
