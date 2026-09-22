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

  private static generatePubspecYaml(projectName: string): string {
    const pkgName = `${this.toDartFileName(projectName)}_app`;
    return `name: ${pkgName}
description: "App Flutter generada automaticamente por ClassForge para ${projectName}: CRUD contra el backend Spring Boot generado, mas un agente de chat y voz con IA local (Gemma on-device)."
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.3.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  http: ^1.6.0
  speech_to_text: ^7.5.0
  flutter_tts: ^4.2.5
  flutter_gemma: ^1.8.3
  flutter_gemma_litertlm: ^1.6.4

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0

flutter:
  uses-material-design: true
  assets:
    - assets/schema_context.json
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

  private static generateLocalAiServiceDart(): string {
    return `import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_gemma/flutter_gemma.dart';

/// Envoltorio sobre flutter_gemma (LLM Gemma on-device, sin llamadas a la nube en tiempo
/// de ejecucion) generado por ClassForge. Usa tipos dinamicos para el modelo/chat porque la
/// version exacta de la API puede variar entre releases de flutter_gemma; si el compilador
/// se queja de un metodo/propiedad aqui, revisa el README del paquete instalado
/// (pub.dev/packages/flutter_gemma) y ajusta esta clase — el resto de la app no depende de
/// los tipos internos de flutter_gemma, solo de ask()/ensureModelReady()/dispose().
class LocalAiService {
  // Modelo Gemma cuantizado pequeno (~1B params) en formato .litertlm. Se descarga la
  // primera vez que se ejecuta la app (requiere internet); despues corre 100% offline.
  // Los modelos Gemma en Hugging Face suelen requerir cuenta + token (ver README.md).
  static const String _modelFileName = 'Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm';
  static const String _modelUrl =
      'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm';

  dynamic _model;
  dynamic _chat;
  String? _schemaContext;

  Future<void> _loadSchemaContext() async {
    if (_schemaContext != null) return;
    _schemaContext = await rootBundle.loadString('assets/schema_context.json');
  }

  /// Descarga el modelo si aun no esta instalado en el dispositivo. [onProgress] recibe
  /// valores 0-100. [hfToken] es opcional: solo necesario si el modelo en Hugging Face
  /// esta protegido (ver README.md sobre --dart-define=HF_TOKEN=...).
  Future<void> ensureModelReady({void Function(double progress)? onProgress, String? hfToken}) async {
    final installed = await FlutterGemma.isModelInstalled(_modelFileName);
    if (installed) return;

    await FlutterGemma.installModel(
      modelType: ModelType.gemmaIt,
      fileType: ModelFileType.litertlm,
    )
        .fromNetwork(_modelUrl, token: hfToken)
        .withProgress((progress) => onProgress?.call(progress.toDouble()))
        .install();
  }

  Future<void> _ensureChat() async {
    if (_chat != null) return;
    await _loadSchemaContext();
    _model = await FlutterGemma.getActiveModel(maxTokens: 2048);
    _chat = await _model.createChat(
      systemInstruction: 'Eres el agente de IA local de esta app (generada por ClassForge). '
          'Responde siempre en espanol, de forma breve y precisa, usando como contexto el '
          'siguiente esquema de datos en JSON del backend: \$_schemaContext',
    );
  }

  /// Envia [prompt] al modelo local y devuelve su respuesta como texto.
  Future<String> ask(String prompt) async {
    await _ensureChat();
    await _chat.addQueryChunk(Message.text(text: prompt, isUser: true));
    final response = await _chat.generateChatResponse();
    return response.toString();
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
    return `import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:flutter_tts/flutter_tts.dart';
import '../services/local_ai_service.dart';

class _ChatMessage {
  final String text;
  final bool isUser;
  _ChatMessage(this.text, this.isUser);
}

/// Pantalla de agente conversacional (chat + voz) con IA local, generada por ClassForge.
class AiChatScreen extends StatefulWidget {
  const AiChatScreen({super.key});

  @override
  State<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends State<AiChatScreen> {
  final LocalAiService _ai = LocalAiService();
  final stt.SpeechToText _speech = stt.SpeechToText();
  final FlutterTts _tts = FlutterTts();
  final TextEditingController _controller = TextEditingController();
  final List<_ChatMessage> _messages = [];

  bool _modelReady = false;
  bool _downloading = false;
  double _downloadProgress = 0;
  bool _listening = false;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _tts.setLanguage('es-ES');
    _prepareModel();
  }

  Future<void> _prepareModel() async {
    setState(() => _downloading = true);
    // Token opcional para modelos Gemma protegidos en Hugging Face. Se pasa en build/run
    // con: flutter run --dart-define=HF_TOKEN=tu_token (ver README.md). Nunca lo hardcodees.
    const hfToken = String.fromEnvironment('HF_TOKEN');
    try {
      await _ai.ensureModelReady(
        onProgress: (p) => setState(() => _downloadProgress = p),
        hfToken: hfToken.isEmpty ? null : hfToken,
      );
      if (!mounted) return;
      setState(() {
        _modelReady = true;
        _downloading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _downloading = false);
      _messages.add(_ChatMessage(
        'No se pudo descargar/inicializar el modelo de IA local: \$e\\n'
        'Revisa tu conexion a internet y, si el modelo requiere autenticacion en Hugging '
        'Face, configura --dart-define=HF_TOKEN=tu_token (ver README.md).',
        false,
      ));
    }
  }

  Future<void> _send(String text) async {
    if (text.trim().isEmpty || !_modelReady || _sending) return;
    setState(() {
      _messages.add(_ChatMessage(text, true));
      _sending = true;
    });
    _controller.clear();
    try {
      final reply = await _ai.ask(text);
      if (!mounted) return;
      setState(() => _messages.add(_ChatMessage(reply, false)));
      await _tts.speak(reply);
    } catch (e) {
      if (!mounted) return;
      setState(() => _messages.add(_ChatMessage('Error del agente de IA local: \$e', false)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _toggleListening() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
      return;
    }
    final available = await _speech.initialize();
    if (!available) return;
    setState(() => _listening = true);
    await _speech.listen(
      localeId: 'es_ES',
      onResult: (result) {
        _controller.text = result.recognizedWords;
        if (result.finalResult) {
          setState(() => _listening = false);
          _send(result.recognizedWords);
        }
      },
    );
  }

  @override
  void dispose() {
    _ai.dispose();
    _tts.stop();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Agente IA Local')),
      body: Column(
        children: [
          if (_downloading)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text('Descargando modelo de IA local... \${_downloadProgress.toStringAsFixed(0)}%'),
                  const SizedBox(height: 8),
                  LinearProgressIndicator(value: _downloadProgress / 100),
                ],
              ),
            ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final m = _messages[index];
                return Align(
                  alignment: m.isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: m.isUser ? Colors.indigo.shade100 : Colors.grey.shade200,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(m.text),
                  ),
                );
              },
            ),
          ),
          if (_sending) const LinearProgressIndicator(),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                IconButton(
                  icon: Icon(_listening ? Icons.mic : Icons.mic_none),
                  onPressed: _modelReady ? _toggleListening : null,
                ),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: _modelReady && !_sending,
                    decoration: const InputDecoration(hintText: 'Preguntale algo al agente...'),
                    onSubmitted: _send,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: _modelReady && !_sending ? () => _send(_controller.text) : null,
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
${screenEntries}
    const AiChatScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
${destinationEntries}
          const NavigationDestination(icon: Icon(Icons.smart_toy_outlined), label: 'Agente IA'),
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

## 4. IA local (Gemma on-device)

El agente descarga un modelo Gemma cuantizado (~1B parametros, formato \`.litertlm\`) la
**primera vez** que abres la pantalla "Agente IA" (necesita internet esa vez); despues corre
100% offline en el dispositivo, sin llamar a ningun servicio en la nube.

Los modelos Gemma en Hugging Face suelen estar protegidos (requieren cuenta gratuita +
aceptar la licencia + un access token). Si la descarga falla con un error de autenticacion:

1. Crea una cuenta en https://huggingface.co y acepta la licencia del modelo
   \`litert-community/Gemma3-1B-IT\`.
2. Genera un access token en tu perfil de Hugging Face.
3. Corre la app pasando el token por variable de compilacion (nunca lo hardcodees ni lo
   subas a git):

   \`\`\`
   flutter run --dart-define=HF_TOKEN=tu_token_de_huggingface
   \`\`\`

## 5. Ejecutar

\`\`\`
flutter pub get
flutter run
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
    const root = parentFolder.folder(folderName)!;
    root.file('pubspec.yaml', this.generatePubspecYaml(projectName));
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
    servicesFolder.file('local_ai_service.dart', this.generateLocalAiServiceDart());
    screensFolder.file('ai_chat_screen.dart', this.generateAiChatScreenDart());

    const assetsFolder = root.folder('assets')!;
    assetsFolder.file('schema_context.json', this.generateSchemaContextJson(entities, projectName));
  }
}
