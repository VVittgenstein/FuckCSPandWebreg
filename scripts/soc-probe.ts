/**
 * Rutgers SOC API 探针脚本
 * 用于验证端点可用性、测量响应时间、抓取样本数据
 */

interface ProbeConfig {
  baseUrl: string;
  year: number;
  term: string;  // "0" = Winter, "1" = Spring, "7" = Summer, "9" = Fall
  campus: string; // "NB" = New Brunswick, "NK" = Newark, "CM" = Camden
  level: string;  // "U" = Undergraduate, "G" = Graduate
  subject?: string; // 例如 "198" for Computer Science
}

interface APIResponse {
  success: boolean;
  data?: any;
  error?: string;
  responseTime: number;
  statusCode?: number;
}

interface ProbeResult {
  endpoint: string;
  params: Record<string, string>;
  attempts: number;
  successes: number;
  failures: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  sampleSize: number;
  timestamp: string;
}

/**
 * 发送 API 请求并测量响应时间
 */
async function probeAPI(config: ProbeConfig): Promise<APIResponse> {
  const { baseUrl, year, term, campus, level, subject } = config;

  const params = new URLSearchParams({
    year: year.toString(),
    term: term,
    campus: campus,
    level: level,
  });

  if (subject) {
    params.append('subject', subject);
  }

  const url = `${baseUrl}?${params.toString()}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BetterCourseSchedulePlanner/1.0 (Educational Research)',
      },
    });

    const endTime = performance.now();
    const responseTime = endTime - startTime;

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        responseTime,
        statusCode: response.status,
      };
    }

    const data = await response.json();

    return {
      success: true,
      data,
      responseTime,
      statusCode: response.status,
    };
  } catch (error) {
    const endTime = performance.now();
    const responseTime = endTime - startTime;

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      responseTime,
    };
  }
}

/**
 * 执行多次探测并汇总统计
 */
async function runProbe(
  config: ProbeConfig,
  attempts: number = 3,
  delayMs: number = 1000
): Promise<ProbeResult> {
  const results: APIResponse[] = [];

  console.log(`\n🔍 探测端点: ${config.baseUrl}`);
  console.log(`📊 参数: year=${config.year}, term=${config.term}, campus=${config.campus}, level=${config.level}, subject=${config.subject || 'all'}`);
  console.log(`🔁 尝试次数: ${attempts}\n`);

  for (let i = 0; i < attempts; i++) {
    console.log(`  [${i + 1}/${attempts}] 发送请求...`);
    const result = await probeAPI(config);
    results.push(result);

    if (result.success) {
      console.log(`  ✅ 成功 - 响应时间: ${result.responseTime.toFixed(2)}ms`);
    } else {
      console.log(`  ❌ 失败 - ${result.error}`);
    }

    // 延迟以避免速率限制
    if (i < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;
  const responseTimes = results.map(r => r.responseTime);
  const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const minResponseTime = Math.min(...responseTimes);
  const maxResponseTime = Math.max(...responseTimes);

  // 获取样本大小（课程数量）
  let sampleSize = 0;
  const successResult = results.find(r => r.success);
  if (successResult?.data) {
    // 根据实际 API 响应结构调整
    sampleSize = Array.isArray(successResult.data)
      ? successResult.data.length
      : (successResult.data.length || 0);
  }

  const params: Record<string, string> = {
    year: config.year.toString(),
    term: config.term,
    campus: config.campus,
    level: config.level,
  };

  if (config.subject) {
    params.subject = config.subject;
  }

  return {
    endpoint: config.baseUrl,
    params,
    attempts,
    successes,
    failures,
    avgResponseTime,
    minResponseTime,
    maxResponseTime,
    sampleSize,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 主函数 - 执行探测任务
 */
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Rutgers SOC API 探针 v1.0');
  console.log('═══════════════════════════════════════════════════\n');

  const baseUrl = 'https://sis.rutgers.edu/soc/api/openSections.json';

  // 探测配置列表
  const probeConfigs: ProbeConfig[] = [
    {
      baseUrl,
      year: 2025,
      term: '1',      // Spring 2025
      campus: 'NB',   // New Brunswick
      level: 'U',     // Undergraduate
      subject: '198', // Computer Science
    },
    {
      baseUrl,
      year: 2025,
      term: '1',
      campus: 'NB',
      level: 'U',
      subject: '640', // Mathematics
    },
    {
      baseUrl,
      year: 2025,
      term: '9',      // Fall 2025
      campus: 'NB',
      level: 'U',
      subject: '198',
    },
  ];

  const probeResults: ProbeResult[] = [];

  // 执行探测
  for (const config of probeConfigs) {
    const result = await runProbe(config, 3, 1500);
    probeResults.push(result);
  }

  // 输出汇总报告
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   探测汇总报告');
  console.log('═══════════════════════════════════════════════════\n');

  probeResults.forEach((result, index) => {
    console.log(`\n📌 探测 #${index + 1}`);
    console.log(`   端点: ${result.endpoint}`);
    console.log(`   参数: ${JSON.stringify(result.params)}`);
    console.log(`   成功率: ${result.successes}/${result.attempts} (${((result.successes / result.attempts) * 100).toFixed(1)}%)`);
    console.log(`   响应时间: 平均 ${result.avgResponseTime.toFixed(2)}ms | 最小 ${result.minResponseTime.toFixed(2)}ms | 最大 ${result.maxResponseTime.toFixed(2)}ms`);
    console.log(`   样本大小: ${result.sampleSize} 条记录`);
  });

  // 保存结果到 JSON
  const outputPath = './data/probe-results.json';
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify(probeResults, null, 2), 'utf-8');
  console.log(`\n💾 结果已保存至: ${outputPath}`);

  console.log('\n✅ 探测完成！\n');
}

// 运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { probeAPI, runProbe, type ProbeConfig, type APIResponse, type ProbeResult };
