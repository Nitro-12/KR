import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CBR Microservices',
      theme: ThemeData(useMaterial3: true),
      home: const HomePage(),
    );
  }
}

class Config {
  final String ratesBase;
  final String analyticsBase;
  final String clientId;

  Config({required this.ratesBase, required this.analyticsBase, required this.clientId});

  static const _kRates = 'ratesBase';
  static const _kAnalytics = 'analyticsBase';
  static const _kClient = 'clientId';

  static Future<Config> load() async {
    final sp = await SharedPreferences.getInstance();
    return Config(
      ratesBase: sp.getString(_kRates) ?? '',
      analyticsBase: sp.getString(_kAnalytics) ?? '',
      clientId: sp.getString(_kClient) ?? 'default',
    );
  }

  Future<void> save() async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_kRates, ratesBase);
    await sp.setString(_kAnalytics, analyticsBase);
    await sp.setString(_kClient, clientId);
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  late TextEditingController _ratesCtl;
  late TextEditingController _analyticsCtl;
  late TextEditingController _clientCtl;

  List<dynamic> _rates = [];
  String _status = '';

  @override
  void initState() {
    super.initState();
    _ratesCtl = TextEditingController();
    _analyticsCtl = TextEditingController();
    _clientCtl = TextEditingController(text: 'default');
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final cfg = await Config.load();
    setState(() {
      _ratesCtl.text = cfg.ratesBase;
      _analyticsCtl.text = cfg.analyticsBase;
      _clientCtl.text = cfg.clientId;
    });
  }

  Future<void> _saveConfig() async {
    final cfg = Config(
      ratesBase: _ratesCtl.text.trim(),
      analyticsBase: _analyticsCtl.text.trim(),
      clientId: (_clientCtl.text.trim().isEmpty) ? 'default' : _clientCtl.text.trim(),
    );
    await cfg.save();
    setState(() => _status = 'Сохранено');
  }

  Future<Config> _cfg() async {
    final cfg = await Config.load();
    return cfg;
  }

  Future<void> _loadDaily() async {
    final cfg = await _cfg();
    if (cfg.ratesBase.isEmpty) {
      setState(() => _status = 'Укажи Rates API URL');
      return;
    }
    setState(() => _status = 'Загрузка...');
    try {
      final uri = Uri.parse('${cfg.ratesBase}/cbr/daily');
      final resp = await http.get(uri).timeout(const Duration(seconds: 20));
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      if (data['error'] != null) throw Exception(data['error']);
      setState(() {
        _rates = (data['items'] as List<dynamic>)..sort((a,b)=> (a['CharCode']??a['char_code']??'').toString().compareTo((b['CharCode']??b['char_code']??'').toString()));
        _status = 'Дата ЦБ: ${data['date'] ?? ''} · записей: ${_rates.length}';
      });
    } catch (e) {
      setState(() => _status = 'Ошибка: $e');
    }
  }

  Future<void> _forecastUsd() async {
    final cfg = await _cfg();
    if (cfg.analyticsBase.isEmpty) {
      setState(() => _status = 'Укажи Analytics API URL');
      return;
    }
    setState(() => _status = 'Прогноз...');
    try {
      final uri = Uri.parse('${cfg.analyticsBase}/analytics/forecast').replace(queryParameters: {
        'code': 'USD',
        'days': '7',
        'client_id': cfg.clientId,
      });
      final resp = await http.get(uri).timeout(const Duration(seconds: 25));
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      if (data['error'] != null) throw Exception(data['error']);
      final List<dynamic> fc = data['forecast'] as List<dynamic>;
      final text = fc.take(3).map((p) => '${p['date']}: ${(p['rub_per_unit_pred'] as num).toStringAsFixed(4)}').join(' · ');
      setState(() => _status = 'USD прогноз (3 дня): $text');
    } catch (e) {
      setState(() => _status = 'Ошибка: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('CBR Microservices')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Настройки', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            controller: _ratesCtl,
            decoration: const InputDecoration(labelText: 'Rates API URL', hintText: 'https://rates-service.onrender.com'),
          ),
          TextField(
            controller: _analyticsCtl,
            decoration: const InputDecoration(labelText: 'Analytics API URL', hintText: 'https://analytics-service.onrender.com'),
          ),
          TextField(
            controller: _clientCtl,
            decoration: const InputDecoration(labelText: 'Client ID', hintText: 'default'),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              FilledButton(onPressed: _saveConfig, child: const Text('Сохранить')),
              OutlinedButton(onPressed: _loadDaily, child: const Text('Курсы')),
              OutlinedButton(onPressed: _forecastUsd, child: const Text('Прогноз USD')),
            ],
          ),
          const SizedBox(height: 12),
          Text(_status),
          const Divider(height: 24),
          const Text('Список курсов (daily)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (_rates.isEmpty) const Text('Нажми “Курсы”, чтобы загрузить.'),
          for (final it in _rates.take(30))
            ListTile(
              dense: true,
              title: Text('${it['char_code'] ?? it['CharCode']} — ${it['Name'] ?? it['name']}'),
              subtitle: Text('Номинал: ${it['nominal'] ?? it['Nominal']} · Значение: ${it['value'] ?? it['Value']}'),
            ),
          if (_rates.length > 30)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Показаны первые 30 строк.'),
            ),
        ],
      ),
    );
  }
}
