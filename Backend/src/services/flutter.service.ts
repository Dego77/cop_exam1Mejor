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
  flutter_gemma: ^1.8.3
  flutter_gemma_litertlm: ^1.6.4
  vosk_flutter_2: ^1.0.0
  sqflite: ^2.4.2
  path: ^1.9.1
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

  Future<void> ensureModelReady({
    void Function(double progress)? onProgress,
    String? hfToken,
    String? pickedFilePath,
  }) async {
    final installed = await FlutterGemma.isModelInstalled(_modelFileName);
    if (installed) return;

    final installer = FlutterGemma.installModel(
      modelType: ModelType.gemmaIt,
      fileType: ModelFileType.litertlm,
    );
    String? localPath = pickedFilePath;
    if (localPath == null) {
      try {
        if (File(_phoneDownloadPath).existsSync()) localPath = _phoneDownloadPath;
      } catch (_) {}
    }
    if (localPath != null) {
      await installer.fromFile(localPath).install();
      return;
    }

    await installer
        .fromNetwork(_modelUrl, token: hfToken)
        .withProgress((progress) => onProgress?.call(progress.toDouble()))
        .install();
  }

  Future<void> _ensureChat() async {
    if (_chat != null) return;
    await _loadSchemaContext();
    _model = await FlutterGemma.getActiveModel(maxTokens: 512);
    _chat = await _model.createChat(
      systemInstruction: 'Eres el interprete de ordenes de esta app. '
          'Responde unicamente con un JSON valido, sin markdown ni texto extra, de esta forma: '
          '{"accion":"REGISTRAR","entidad":"NombreDeLaClase","datos":{"campo":"valor"}}. '
          'La entidad tiene que ser una clase del esquema. Los campos de datos tienen que ser atributos de esa clase. '
          'No inventes clases ni campos. Si la frase no pide registrar nada, usa "accion":"DESCONOCIDA". '
          'Esquema: \$_schemaContext',
    );
  }

  Future<VoiceCommand> interpret(String phrase) async {
    await _loadSchemaContext();
    _chat = null;
    await _ensureChat();
    await _chat.addQueryChunk(Message.text(text: phrase, isUser: true));
    final response = await _chat.generateChatResponse();
    final raw = response.toString();
    final match = RegExp(r'\\{[\\s\\S]*\\}').firstMatch(raw);
    if (match == null) {
      throw Exception('Gemma no devolvio una orden. Dijo: \$raw');
    }
    final decoded = jsonDecode(match.group(0)!);
    if (decoded is! Map) {
      throw Exception('La orden no es un objeto JSON.');
    }
    final accion = (decoded['accion'] ?? '').toString().toUpperCase();
    final entidadPedida = (decoded['entidad'] ?? '').toString();
    final datosRaw = decoded['datos'];
    final datos = datosRaw is Map ? Map<String, dynamic>.from(datosRaw) : <String, dynamic>{};

    final schema = jsonDecode(_schemaContext!) as Map<String, dynamic>;
    final entidades = (schema['entidades'] as List<dynamic>? ?? const []);
    Map<String, dynamic>? entidad;
    for (final item in entidades) {
      if (item is Map && (item['entidad'] ?? '').toString().toLowerCase() == entidadPedida.toLowerCase()) {
        entidad = Map<String, dynamic>.from(item);
        break;
      }
    }
    if (accion != 'REGISTRAR' || entidad == null) {
      throw Exception('No entendi una orden de registro. Gemma respondio: \$raw');
    }

    final atributos = (entidad['atributos'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((a) => Map<String, dynamic>.from(a))
        .toList();
    final payload = <String, dynamic>{};
    datos.forEach((key, value) {
      final attr = atributos.cast<Map<String, dynamic>?>().firstWhere(
        (a) => (a?['nombre'] ?? '').toString().toLowerCase() == key.toString().toLowerCase(),
        orElse: () => null,
      );
      if (attr != null && attr['pk'] != true && value != null && value.toString().trim().isNotEmpty) {
        payload[attr['nombre'].toString()] = value;
      }
    });

    return VoiceCommand(
      accion: 'REGISTRAR',
      entidad: entidad['entidad'].toString(),
      endpoint: entidad['tabla'].toString(),
      datos: payload,
    );
  }

  Future<void> dispose() async {
    try {
      await _model?.close();
    } catch (_) {}
  }
}
`;
  }

  private static generateAiChatScreenDart(): string {
    return `import 'dart:async';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:vosk_flutter_2/vosk_flutter_2.dart';

import '../config/api_config.dart';
import '../services/local_ai_service.dart';
import '../services/local_store.dart';
import 'package:http/http.dart' as http;

/// Pantalla de voz. Vosk oye sin internet, Gemma arma la orden y SQLite la guarda.
class AiChatScreen extends StatefulWidget {
  const AiChatScreen({super.key});

  @override
  State<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends State<AiChatScreen> {
  final LocalAiService _ai = LocalAiService();
  final FlutterTts _tts = FlutterTts();
  final List<PendingOp> _pending = [];

  SpeechService? _speech;
  StreamSubscription<String>? _partialSub;
  StreamSubscription<String>? _resultSub;
  String _heard = '';
  String _status = 'Preparando la voz y el modelo...';
  bool _modelReady = false;
  bool _listening = false;
  bool _busy = false;
  bool _downloading = false;
  double _downloadProgress = 0;

  @override
  void initState() {
    super.initState();
    _tts.setLanguage('es-ES');
    _prepare();
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
        setState(() => _heard = text);
      });
      _resultSub = _speech!.onResult().listen((raw) {
        final text = _textFromVosk(raw);
        if (text.isEmpty || !mounted) return;
        setState(() => _heard = text);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'No pude cargar el modelo de voz. Copia vosk-model-small-es-0.42.zip dentro de assets/models. Detalle: \$e');
      return;
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
        _status = 'Listo. Pulsa el microfono y dicta la orden.';
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

  Future<void> _toggleListening() async {
    final speech = _speech;
    if (speech == null || !_modelReady || _busy) return;
    if (_listening) {
      await speech.stop();
      setState(() => _listening = false);
      final phrase = _heard.trim();
      if (phrase.isNotEmpty) await _register(phrase);
      return;
    }
    setState(() {
      _heard = '';
      _listening = true;
      _status = 'Te escucho...';
    });
    await speech.start();
  }

  Future<void> _register(String phrase) async {
    setState(() {
      _busy = true;
      _status = 'Interpretando: \$phrase';
    });
    try {
      final command = await _ai.interpret(phrase);
      final payload = jsonEncode(command.datos);
      await LocalStore.insert(entidad: command.entidad, endpoint: command.endpoint, payload: payload);
      await _reloadPending();
      final spoken = 'Guarde \${command.entidad} en el telefono.';
      setState(() => _status = spoken);
      await _tts.speak(spoken);
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = 'No pude registrar esa orden. \$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
        _status = 'Listo. Pulsa el microfono y dicta la orden.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = false;
        _status = 'No pude instalar ese archivo. \$e';
      });
    }
  }

  Future<void> _sync() async {
    setState(() => _busy = true);
    var sent = 0;
    var failed = 0;
    final rows = await LocalStore.pending();
    for (final op in rows) {
      try {
        final res = await http.post(
          Uri.parse('\${ApiConfig.baseUrl}/\${op.endpoint}'),
          headers: {'Content-Type': 'application/json'},
          body: op.payload,
        );
        if (res.statusCode == 200 || res.statusCode == 201) {
          await LocalStore.markSynced(op.id);
          sent++;
        } else {
          failed++;
        }
      } catch (_) {
        failed++;
      }
    }
    await _reloadPending();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = failed == 0
          ? 'Sincronice \$sent registro(s) con el servidor.'
          : 'Enviados: \$sent. Sin red o con error: \$failed. Se quedan en el telefono.';
    });
  }

  @override
  void dispose() {
    _partialSub?.cancel();
    _resultSub?.cancel();
    _speech?.stop();
    _ai.dispose();
    _tts.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Voz sin internet')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_status),
            if (_downloading) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: _downloadProgress > 0 ? _downloadProgress / 100 : null),
            ],
            const SizedBox(height: 12),
            Text(_heard.isEmpty ? 'Aun no oigo nada.' : _heard, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _modelReady && !_busy ? _toggleListening : null,
              icon: Icon(_listening ? Icons.stop : Icons.mic),
              label: Text(_listening ? 'Detener y guardar' : 'Hablar'),
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
            Expanded(
              child: ListView.builder(
                itemCount: _pending.length,
                itemBuilder: (context, index) {
                  final op = _pending[index];
                  return ListTile(
                    title: Text(op.entidad),
                    subtitle: Text(op.payload),
                  );
                },
              ),
            ),
          ],
        ),
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

    const screenEntries = crudEntities
      .map((e) => `    const ${e.className}ListScreen(),`)
      .join('\n');

    const destinationEntries = crudEntities
      .map((e) => `          NavigationDestination(icon: const Icon(Icons.table_rows_outlined), label: '${e.className}'),`)
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

  final List<Widget> _screens = [
    const AiChatScreen(),
${screenEntries}
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.mic_none), label: 'Voz'),
${destinationEntries}
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
        relaciones: (e.relationships || []).map((r: any) => ({ tipo: r.type, hacia: r.targetEntity })),
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
    screensFolder.file('ai_chat_screen.dart', this.generateAiChatScreenDart());

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
