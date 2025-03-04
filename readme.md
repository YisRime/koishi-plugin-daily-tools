# koishi-plugin-daily-tools

[![npm](https://img.shields.io/npm/v/koishi-plugin-daily-tools?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-daily-tools)

一些小工具，提供精致睡眠，随机禁言以及自动点赞等功能

## 功能特性

### 精致睡眠

- 支持固定时长、指定时间、随机时长三种模式
- 可配置允许使用的时间段
- 自动解除禁言

### 随机禁言

- 固定时长或随机时长
- 自主禁言或随机选择目标
- 可配置禁言成功概率
- 支持禁言时长上限

### 自动点赞

- 手动点赞功能
- 自动批量点赞
- 点赞目标管理
- 管理员权限控制

## 命令列表

### sleep - 精致睡眠

- `sleep` - 执行精致睡眠

### mute - 禁言功能

- `mute [时长]` - 随机禁言
- `mute.me [时长]` - 禁言自己
- `mute.user @用户 [时长]` - 禁言指定用户

### zanwo - 自动点赞

- `zanwo` - 为自己点赞
- `zanwo.list` - 查看点赞列表
- `zanwo.add @用户` - 添加到点赞列表
- `zanwo.remove @用户` - 从点赞列表移除
- `zanwo.user @用户` - 为指定用户点赞

## 配置说明

### 自动点赞配置

```yaml
adminAccount: '管理员账号'  # 管理员QQ号
enableNotify: true         # 点赞成功时是否提示
adminOnly: true           # 是否仅管理员可配置点赞列表
enableAutoBatch: false    # 是否启用每日自动批量点赞
```

### 禁言配置

```yaml
sleep:
  type: 'static'          # 睡眠模式: static(固定时长)/until(截止时间)/random(随机时长)
  duration: 8             # 固定时长模式下的小时数
  until: '08:00'         # 指定时间模式下的时间点
  min: 6                 # 随机时长模式下的最小小时数
  max: 10                # 随机时长模式下的最大小时数

mute:
  type: 'static'          # 普通禁言模式: static(固定时长)/random(随机时长)
  duration: 5             # 固定时长（分钟）
  min: 1                 # 随机时长最小值（分钟）
  max: 10                # 随机时长最大值（分钟）

allowedTimeRange: '20-8'  # 允许睡眠的时间段(HH-HH)
maxAllowedDuration: 1440  # 最大普通禁言限制（分钟）
enableMessage: false      # 是否启用禁言提示
enableMuteOthers: true   # 是否允许禁言他人
probability: 0.5         # 禁言成功概率(0-1)
```

## 注意事项

1. 禁言功能需要机器人具有相应权限
2. 点赞功能仅支持 OneBot v11 协议
3. 自动批量点赞建议在非高峰期执行
