// =================配置区域=================
const API_KEY = 'sk-or-v1-2c2f931f64bed4bbc0c0e0cce9a4888f6e8808a085a13'; // ⚠️ 记得填你的 Key
const API_URL = 'https://openrouter.ai/api/v1/chat/completions'; 
// =========================================

const writeBtn = document.getElementById("writeBtn");
const userPrompt = document.getElementById("userPrompt");
const statusDiv = document.getElementById("status");
const aiResponseArea = document.getElementById("aiResponse");

// === 🎒 记忆背包 UI 元素 ===
const toggleMemoryBtn = document.getElementById("toggleMemoryBtn");
const memoryArea = document.getElementById("memoryArea");
const memoryContent = document.getElementById("memoryContent");
const saveMemoryBtn = document.getElementById("saveMemoryBtn");

// 初始化：加载记忆
chrome.storage.local.get(["userMemory"], (result) => {
  if (result.userMemory) {
    memoryContent.value = result.userMemory;
  }
});

// 切换显示背包
toggleMemoryBtn.addEventListener("click", () => {
    if (memoryArea.style.display === "none") {
        memoryArea.style.display = "block";
        toggleMemoryBtn.innerText = "🎒 收起背包";
    } else {
        memoryArea.style.display = "none";
        toggleMemoryBtn.innerText = "🎒 我的记忆背包";
    }
});

// 保存记忆
saveMemoryBtn.addEventListener("click", () => {
    const memoryText = memoryContent.value;
    chrome.storage.local.set({ userMemory: memoryText }, () => {
        const originalText = saveMemoryBtn.innerText;
        saveMemoryBtn.innerText = "✅ 已保存";
        setTimeout(() => { saveMemoryBtn.innerText = originalText; }, 1000);
    });
});

writeBtn.addEventListener("click", async () => {
  const prompt = userPrompt.value;
  if (!prompt) {
    statusDiv.innerText = "⚠️ 请下达指令（比如：登录、搜索xx）";
    return;
  }
  
  writeBtn.disabled = true;

  try {
    statusDiv.innerText = "👀 侦察兵正在分析战场（找框+找按钮）...";
    
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // === 第一步：扫描全场（框 + 按钮 + 文字） ===
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: analyzePageElements, // 👈 升级版的侦察兵
    });

    const pageData = result[0].result;
    
    // === 第二步：制定作战计划 ===
    statusDiv.innerText = "🧠 指挥官正在制定计划...";
    
    const uiContext = JSON.stringify({
        inputs: pageData.inputs,
        buttons: pageData.buttons
    });
    
    // 获取记忆背包内容
    const memoryData = await chrome.storage.local.get(["userMemory"]);
    const userMemory = memoryData.userMemory || "（用户暂无存储的个人信息）";

    const fullPrompt = `
      【网页背景文字】：${pageData.text}
      
      【潜在数据区域】：${pageData.dataContext || "无"}
      
      【网页UI元素清单】：${uiContext}
      
      【用户记忆背包】：${userMemory}

      【用户指令】：${prompt}
      
      【任务】：
      请判断用户的意图是 "操作网页"、"抓取数据" 还是 "普通问答/摘要"。
      
      1. 如果是 **操作网页**：
         - 结合【用户记忆背包】决定输入框 (fill) 的内容。
         - 决定需要点击的按钮 (click)。
         
      2. 如果是 **抓取数据**：
         - 提取信息并整理为 scrape.data (JSON数组)。
         - 指定文件名 scrape.filename (.csv)。
         
      3. 如果是 **普通问答/摘要**：
         - 如果用户只是问问题，或者让你总结网页，或者没有网页操作/抓取的需求。
         - 请把回答写在 message 字段里。
      
      【输出格式 (JSON)】：
      {
        // 场景 A：操作
        "fill": {"输入框ID": "内容", ...},
        "click": "按钮ID",
        
        // 场景 B：抓取
        "scrape": { ... },
        
        // 场景 C：回答/摘要
        "message": "这里写你的纯文本回答..."
      }
      (请只返回一个 JSON 对象，不要 markdown 格式)
    `;

    const aiResponseText = await callAI(fullPrompt);
    console.log("AI计划：", aiResponseText);

    // === 第三步：执行计划 (Message / Scrape / Action) ===
    statusDiv.innerText = "⚡️ 正在处理...";

    const cleanJson = aiResponseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const actionPlan = JSON.parse(cleanJson);

    // 1. 纯文本回答
    if (actionPlan.message) {
        statusDiv.innerText = "✅ AI 已回复";
        aiResponseArea.style.display = "block";
        aiResponseArea.value = actionPlan.message;
        
        // 如果没有其他操作，就不往下走了
        if (!actionPlan.fill && !actionPlan.click && !actionPlan.scrape) {
            return;
        }
    } else {
        aiResponseArea.style.display = "none";
        aiResponseArea.value = "";
    }

    // 2. 抓取数据 (在 Popup 里生成文件直接下载即可)
    if (actionPlan.scrape) {
        statusDiv.innerText = "📊 正在导出数据...";
        exportToCSV(actionPlan.scrape.data, actionPlan.scrape.filename);
        statusDiv.innerText = "✅ 数据已导出！";
        // 抓取通常也是终点，但也可能混合
        if (!actionPlan.fill && !actionPlan.click) {
             return;
        }
    }

    // 3. 网页操作 (填表 + 点击) -> 需要注入到页面去执行
    if (actionPlan.fill || actionPlan.click) {
        statusDiv.innerText = "⚡️ 正在执行页面操作...";
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: executeActionPlan, // 👈 升级版的执行者
          args: [actionPlan]
        });
        statusDiv.innerText = "✅ 操作指令已发送";
    }

    statusDiv.innerText = "✅ 任务完成！";

  } catch (error) {
    console.error(error);
    statusDiv.innerText = "❌ 出错：" + error.message;
  } finally {
    writeBtn.disabled = false;
  }
});

// ==========================================
// 🕵️‍♂️ 侦察兵 v2.0：找输入框 + 找按钮
// ==========================================
function analyzePageElements() {
  const bodyText = document.body.innerText;

  // 1. 找输入框 (Inputs)
  const inputEls = document.querySelectorAll('input, textarea');
  const inputList = [];
  inputEls.forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image' || el.disabled) return;
    inputList.push({
        key: el.name || el.id || ("idx_" + inputList.length), 
        placeholder: el.placeholder || "",
        label: el.previousElementSibling?.innerText || "" // 简单猜一下旁边的字
    });
  });

  // 2. 找按钮 (Buttons)
  // 我们找 <button>, <input type="submit">, 和长得像按钮的 <a>
  const btnEls = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, div[role="button"]');
  const btnList = [];
  btnEls.forEach((el, index) => {
    // 只有看得见的按钮才算
    if (el.offsetParent === null) return; 
    
    let btnText = el.innerText || el.value || el.title || "未命名按钮";
    // 截断太长的按钮文字
    btnText = btnText.substring(0, 20).replace(/\n/g, "");

    btnList.push({
        key: el.id || el.name || ("btn_idx_" + index), // 唯一标识
        text: btnText // 比如 "登录", "Submit", "搜索"
    });
  });

  // 3. (新) 找数据容器 (Tables, Lists)
  // 如果用户想抓取数据，把 tables 和 ul/ol 的源码或者文本也给 AI
  const dataContainers = document.querySelectorAll('table, ul, ol, div[class*="list"], div[class*="grid"]');
  let dataContext = "";
  dataContainers.forEach((el, index) => {
      // 限制每个块的大小，防止 token 爆炸，只取前 1000 个字符的 innerText 概览
      // 或者如果是 table，取 outerHTML 的简化版? 
      // 这里简化处理：只拼凑 innerText，让 AI 自己去按照换行符猜
      // 更好的做法是给 AI 一部分 HTML 结构，但这里为了省 token，我们先试 text
      if (el.innerText.length > 20) {
          dataContext += `\n--- [Possible Data Block ${index}] ---\n${el.innerText.substring(0, 500)}\n...`;
      }
  });

  return {
    text: bodyText.substring(0, 3000), // 增加一点正文长度
    inputs: inputList,
    buttons: btnList,
    dataContext: dataContext // 👈 专门给抓取任务用的
  };
}

// ==========================================
// ⚡️ 执行者 v2.0：先填后点
// ==========================================
function executeActionPlan(plan) {
  // === 分支 2：如果是操作任务 (Fill & Click) ===
  // 1. 填空
  if (plan.fill) {
    for (const [key, value] of Object.entries(plan.fill)) {
      let el = document.querySelector(`[name="${key}"], #${key}`);
      // 备用查找逻辑
      if (!el && key.startsWith("idx_")) {
          let idx = parseInt(key.split("_")[1]);
          let all = document.querySelectorAll('input, textarea'); // 重新获取列表
           // 这里的逻辑简化了，实际需要保证顺序一致，但在不动DOM的情况下通常没问题
          el = all[idx]; // ⚠️ 简化处理，假设顺序没变
      }

      if (el) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.style.backgroundColor = "#e8f0fe"; 
      }
    }
  }

  // 2. 点击 (延时 500毫秒 再点，让网页反应一下)
  if (plan.click) {
      setTimeout(() => {
          let btn = document.getElementById(plan.click) || document.querySelector(`[name="${plan.click}"]`);
          
          // 如果是用 btn_idx_ 找的
          if (!btn && plan.click.startsWith("btn_idx_")) {
             let idx = parseInt(plan.click.split("_")[2]);
             let allBtns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, div[role="button"]');
             // 再次过滤隐藏的，确保索引对应
             let visibleBtns = Array.from(allBtns).filter(b => b.offsetParent !== null);
             btn = visibleBtns[idx];
          }

          if (btn) {
              console.log("正在点击按钮：", btn);
              btn.style.border = "3px solid red"; // 🔴 点击前标红，让你看清楚点了谁
              btn.click();
          } else {
              console.log("找不到要点的按钮:", plan.click);
          }
      }, 500);
  }
}

// ==========================================
// 📥 导出函数：JSON -> CSV -> 自动下载
// ==========================================
function exportToCSV(data, filename) {
  if (!data || data.length === 0) {
    alert("AI 没有找到有效的数据 :(");
    return;
  }

  // 1. 提取表头 (Keys)
  const headers = Object.keys(data[0]);
  
  // 2. 拼接 CSV 内容
  // BOM (\uFEFF) 让 Excel 能够正确识别 UTF-8 中文
  let csvContent = "\uFEFF"; 
  csvContent += headers.join(",") + "\n"; // 表头行

  data.forEach(row => {
    const rowStr = headers.map(header => {
      let cell = row[header] || "";
      // 处理单元格里的逗号和换行 (用双引号包起来)
      cell = String(cell).replace(/"/g, '""'); 
      if (cell.search(/("|,|\n)/g) >= 0) {
        cell = `"${cell}"`;
      }
      return cell;
    }).join(",");
    csvContent += rowStr + "\n";
  });

  // 3. 创建 Blob 并触发下载
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "data_export.csv";
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// 🧠 AI 呼叫函数 (Prompt 微调)
// ==========================================
async function callAI(prompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "HTTP-Referer": "https://localhost:3000",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" }, 
      messages: [
        { role: "system", content: "你是一个自动化操作助手。请输出纯 JSON。" },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}