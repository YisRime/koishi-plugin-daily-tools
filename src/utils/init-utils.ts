import { Context } from 'koishi'
import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'

// 初始化目录和文件
export async function initializePlugin(ctx: Context, paths: {
  dataDir: string,
  cacheDir: string,
  configDir: string,
  templatesDir: string,
  bindDataFile: string,
  playerTemplateFile: string
}): Promise<boolean> {
  try {
    // 创建必要目录
    for (const dir of [paths.dataDir, paths.cacheDir, paths.configDir, paths.templatesDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        ctx.logger.info(`创建目录: ${dir}`)
      }
    }

    // 创建默认模板文件
    if (!existsSync(paths.playerTemplateFile)) {
      const defaultTemplate = getEnhancedPlayerTemplate()
      await writeFile(paths.playerTemplateFile, defaultTemplate, 'utf8')
      ctx.logger.info(`创建模板文件: ${paths.playerTemplateFile}`)
    }

    // 初始化绑定数据文件
    if (!existsSync(paths.bindDataFile)) {
      const initialData = { group: {}, private: {} }
      await writeFile(paths.bindDataFile, JSON.stringify(initialData, null, 2), 'utf8')
    }

    return true
  } catch (error) {
    ctx.logger.error('插件初始化失败:', error)
    return false
  }
}

// 获取增强的玩家统计模板
function getEnhancedPlayerTemplate(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DDRace Player Stats</title>
  <!-- 引入图表库 -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #f5f5f5;
      color: #333;
      line-height: 1.5;
    }
    .container {
      background-color: white;
      border-radius: 10px;
      box-shadow: 0 3px 15px rgba(0,0,0,0.1);
      padding: 20px;
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #4a76a8, #3a5996);
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
      margin: -20px -20px 20px;
      text-align: center;
      position: relative;
    }
    .player-info {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .player-name {
      font-size: 28px;
      font-weight: bold;
      margin-right: 10px;
    }
    .clan-tag {
      font-size: 18px;
      color: #ffcc00;
    }
    .country-info {
      margin-top: 5px;
      font-size: 14px;
    }
    .country-flag {
      height: 16px;
      vertical-align: middle;
      margin-right: 5px;
    }
    .stats-container {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-bottom: 30px;
    }
    .stats-box {
      flex: 1;
      min-width: 250px;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      overflow: hidden;
    }
    .stats-box-title {
      background-color: #f0f2f5;
      color: #333;
      font-weight: bold;
      padding: 10px 15px;
      border-bottom: 1px solid #e0e0e0;
    }
    .stats-box-content {
      padding: 15px;
    }
    .stats {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .stat-item {
      text-align: center;
      padding: 15px 10px;
      flex: 1;
      min-width: 120px;
      border-radius: 8px;
      background-color: #f9f9f9;
      margin: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      transition: transform 0.2s;
    }
    .stat-item:hover {
      transform: translateY(-3px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #4a76a8;
    }
    .stat-label {
      color: #666;
      font-size: 14px;
      margin-top: 5px;
    }
    .section {
      margin: 25px 0;
      padding: 15px;
      background-color: #fafafa;
      border-radius: 8px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.03);
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #333;
      margin-bottom: 15px;
      border-bottom: 1px solid #eee;
      padding-bottom: 8px;
      display: flex;
      justify-content: space-between;
    }
    .section-title-sub {
      color: #888;
      font-size: 14px;
      font-weight: normal;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    .data-table th {
      text-align: left;
      padding: 10px;
      background-color: #f0f2f5;
      border-bottom: 1px solid #ddd;
      font-weight: 600;
    }
    .data-table td {
      padding: 10px;
      border-bottom: 1px solid #eee;
    }
    .data-table tr:last-child td {
      border-bottom: none;
    }
    .data-table tr:hover {
      background-color: #f5f7fa;
    }
    .flex-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .flex-item {
      background-color: white;
      border-radius: 6px;
      padding: 10px 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      display: flex;
      flex-direction: column;
      min-width: 150px;
    }
    .flex-item-name {
      font-weight: bold;
      margin-bottom: 5px;
      color: #333;
    }
    .flex-item-stat {
      color: #666;
      font-size: 14px;
    }
    .chart-container {
      height: 300px;
      margin: 20px 0;
    }
    .map-type-section {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }
    .map-type-item {
      background-color: white;
      border-radius: 6px;
      padding: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .map-type-name {
      font-weight: bold;
      margin-bottom: 8px;
      color: #333;
    }
    .map-type-stats {
      display: flex;
      justify-content: space-between;
      color: #666;
      font-size: 14px;
    }
    .best-ranks-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 12px;
      margin-top: 15px;
    }
    .rank-item {
      background-color: white;
      border-radius: 6px;
      padding: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .rank-map {
      font-weight: bold;
      color: #333;
    }
    .rank-position {
      color: #e67e22;
      font-weight: 600;
    }
    .rank-time, .rank-date {
      color: #666;
      font-size: 14px;
    }
    .no-data {
      text-align: center;
      color: #999;
      padding: 20px;
      font-style: italic;
    }
    .finishes-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .finishes-table th {
      text-align: left;
      padding: 10px;
      background-color: #f0f2f5;
      border-bottom: 1px solid #ddd;
    }
    .finishes-table td {
      padding: 8px 10px;
      border-bottom: 1px solid #eee;
    }
    .finishes-table tr:hover {
      background-color: #f8f8f8;
    }
    .finish-map {
      font-weight: 600;
      color: #333;
    }
    .finish-points {
      color: #e67e22;
      font-weight: 600;
    }
    .footer {
      text-align: center;
      color: #999;
      font-size: 12px;
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    }
    .tab-container {
      margin-top: 20px;
    }
    .tab-buttons {
      display: flex;
      border-bottom: 1px solid #ddd;
      margin-bottom: 15px;
    }
    .tab-button {
      padding: 10px 20px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      color: #888;
      position: relative;
    }
    .tab-button.active {
      color: #4a76a8;
    }
    .tab-button.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 3px;
      background-color: #4a76a8;
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    @media (max-width: 768px) {
      .stats-container {
        flex-direction: column;
      }
      .best-ranks-list,
      .map-type-section {
        grid-template-columns: 1fr;
      }
      .finishes-table {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="player-info">
        <div class="player-name">{{playerName}}</div>
        {{#if clanTag}}<div class="clan-tag">[{{clanTag}}]</div>{{/if}}
      </div>
      <div class="country-info">
        {{#if countryFlag}}<img class="country-flag" src="{{countryFlag}}" alt="{{country}}">{{/if}}
        {{country}}
      </div>
    </div>

    <div class="stats">
      <div class="stat-item">
        <div class="stat-value">{{points}}</div>
        <div class="stat-label">当前积分</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{playerRank}}</div>
        <div class="stat-label">个人排名</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{teamRank}}</div>
        <div class="stat-label">团队排名</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{totalFinishes}}</div>
        <div class="stat-label">完成次数</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{firstFinishes}}</div>
        <div class="stat-label">首次完成</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">{{mapsPlayed}}</div>
        <div class="stat-label">游玩地图数</div>
      </div>
    </div>

    <div class="tab-container">
      <div class="tab-buttons">
        <button class="tab-button active" data-tab="tab-overview">概览</button>
        <button class="tab-button" data-tab="tab-finishes">最近完成</button>
        <button class="tab-button" data-tab="tab-maps">地图数据</button>
        {{#if extendedStats}}
        <button class="tab-button" data-tab="tab-activity">活动统计</button>
        {{/if extendedStats}}
      </div>

      <div class="tab-content active" id="tab-overview">
        <div class="stats-container">
          <div class="stats-box">
            <div class="stats-box-title">时间统计</div>
            <div class="stats-box-content">
              <table class="data-table">
                <tr>
                  <td>加入日期</td>
                  <td>{{joinDate}}</td>
                </tr>
                <tr>
                  <td>常用服务器</td>
                  <td>{{favoriteServer}} ({{serverFinishes}}次)</td>
                </tr>
                <tr>
                  <td>总积分</td>
                  <td>{{totalPoints}}</td>
                </tr>
              </table>
            </div>
          </div>

          <div class="stats-box">
            <div class="stats-box-title">周期排名</div>
            <div class="stats-box-content">
              <table class="data-table">
                <tr>
                  <td>每周积分</td>
                  <td>{{weeklyPoints}} (第{{weeklyRank}}名)</td>
                </tr>
                <tr>
                  <td>每月积分</td>
                  <td>{{monthlyPoints}} (第{{monthlyRank}}名)</td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        {{#if favoritePartners}}
        <div class="section">
          <div class="section-title">
            常见队友
            <span class="section-title-sub">共{{partnerCount}}名</span>
          </div>
          <div class="flex-list">
            {{#each favoritePartners}}
            <div class="flex-item">
              <div class="flex-item-name">{{name}}</div>
              <div class="flex-item-stat">{{finishes}} 次完成</div>
              {{#if country}}<div class="flex-item-stat">来自 {{country}}</div>{{/if}}
            </div>
            {{/each}}
          </div>
        </div>
        {{/if favoritePartners}}

        {{#if bestRanks}}
        <div class="section">
          <div class="section-title">
            最佳排名
            <span class="section-title-sub">共{{bestRanksCount}}个</span>
          </div>
          <div class="best-ranks-list">
            {{bestRanksContent}}
          </div>
        </div>
        {{/if bestRanks}}
      </div>

      <div class="tab-content" id="tab-finishes">
        {{#if lastFinishes}}
        <div class="section">
          <div class="section-title">
            最近完成
            <span class="section-title-sub">共{{lastFinishesCount}}个</span>
          </div>
          <table class="finishes-table">
            <thead>
              <tr>
                <th>地图</th>
                <th>时间</th>
                <th>类型</th>
                <th>地区</th>
                <th>日期</th>
                <th>得分</th>
              </tr>
            </thead>
            <tbody>
              {{#each lastFinishes}}
              <tr>
                <td>{{map}}</td>
                <td>{{time}}</td>
                <td>{{type}}</td>
                <td>{{country}}</td>
                <td>{{date}}</td>
                <td>{{points}}</td>
              </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
        {{/if lastFinishes}}
      </div>

      <div class="tab-content" id="tab-maps">
        <div class="section">
          <div class="section-title">地图类型得分</div>
          <div class="map-type-section">
            {{typePointsContent}}
          </div>
        </div>

        {{#if favoriteMaps}}
        <div class="section">
          <div class="section-title">
            常玩地图
            <span class="section-title-sub">共{{favoriteMapCount}}个</span>
          </div>
          <div class="flex-list">
            {{favoriteMapsContent}}
          </div>
        </div>
        {{/if favoriteMaps}}
      </div>

      {{#if extendedStats}}
      <div class="tab-content" id="tab-activity">
        <div class="section">
          <div class="section-title">活动统计</div>
          {{#if hasActivity}}
          <div>
            <h3>每周活动</h3>
            <div class="chart-container">
              <canvas id="weeklyActivityChart"></canvas>
            </div>
          </div>
          <div>
            <h3>每月活动</h3>
            <div class="chart-container">
              <canvas id="monthlyActivityChart"></canvas>
            </div>
          </div>
          <script>
            // 处理活动数据图表
            document.addEventListener('DOMContentLoaded', function() {
              // 每周活动
              const weeklyCtx = document.getElementById('weeklyActivityChart').getContext('2d');
              const weeklyData = {{weeklyActivityData}};

              // 获取过去12周的标签
              const weeklyLabels = [];
              for (let i = 0; i < Math.min(12, weeklyData.length); i++) {
                weeklyLabels.unshift(\`-\${i}\`);
              }

              new Chart(weeklyCtx, {
                type: 'bar',
                data: {
                  labels: weeklyLabels,
                  datasets: [{
                    label: '每周积分',
                    data: weeklyData.slice(0, 12).reverse(),
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top',
                    },
                    tooltip: {
                      callbacks: {
                        title: function(tooltipItems) {
                          const idx = tooltipItems[0].dataIndex;
                          return \`\${Math.abs(parseInt(weeklyLabels[idx]))}\` + ' 周前';
                        }
                      }
                    }
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      title: {
                        display: true,
                        text: '积分'
                      }
                    },
                    x: {
                      title: {
                        display: true,
                        text: '周数'
                      }
                    }
                  }
                }
              });

              // 每月活动
              const monthlyCtx = document.getElementById('monthlyActivityChart').getContext('2d');
              const monthlyData = {{monthlyActivityData}};

              // 获取过去12个月的标签
              const monthlyLabels = [];
              for (let i = 0; i < Math.min(12, monthlyData.length); i++) {
                monthlyLabels.unshift(\`-\${i}\`);
              }

              new Chart(monthlyCtx, {
                type: 'bar',
                data: {
                  labels: monthlyLabels,
                  datasets: [{
                    label: '每月积分',
                    data: monthlyData.slice(0, 12).reverse(),
                    backgroundColor: 'rgba(153, 102, 255, 0.5)',
                    borderColor: 'rgba(153, 102, 255, 1)',
                    borderWidth: 1
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: 'top'
                    },
                    tooltip: {
                      callbacks: {
                        title: function(tooltipItems) {
                          const idx = tooltipItems[0].dataIndex;
                          return \`\${Math.abs(parseInt(monthlyLabels[idx]))}\` + ' 月前';
                        }
                      }
                    }
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      title: {
                        display: true,
                        text: '积分'
                      }
                    },
                    x: {
                      title: {
                        display: true,
                        text: '月份'
                      }
                    }
                  }
                }
              });
            });
          </script>
          {{else}}
          <div class="no-data">无活动数据</div>
          {{/if}}
        </div>
      </div>
      {{/if extendedStats}}
    </div>

    <div class="footer">
      由 Koishi daily-tools DDRace 查询功能生成
      <div>数据来源: DDNet.org</div>
    </div>
  </div>

  <script>
    // 标签页切换功能
    document.addEventListener('DOMContentLoaded', function() {
      const tabButtons = document.querySelectorAll('.tab-button');
      const tabContents = document.querySelectorAll('.tab-content');

      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          // 移除所有活动状态
          tabButtons.forEach(btn => btn.classList.remove('active'));
          tabContents.forEach(content => content.classList.remove('active'));

          // 添加当前活动状态
          button.classList.add('active');
          const tabId = button.getAttribute('data-tab');
          document.getElementById(tabId).classList.add('active');
        });
      });
    });
  </script>
</body>
</html>
  `
}
