let currentTabId = null;

document.addEventListener('DOMContentLoaded', function () {
  // 获取当前标签页，用于后续可能的刷新操作
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs.length > 0) {
      currentTabId = tabs[0].id;
      console.log('当前标签页 ID:', currentTabId);
    }
  });

  // 加载代理配置
  chrome.runtime.sendMessage({ action: "getProxyConfig" }, function (config) {
    if (config.server) {
      document.getElementById('proxyServer').value = config.server;
    }
    if (config.port) {
      document.getElementById('proxyPort').value = config.port;
    }
  });

  // 加载被代理的域名列表
  loadProxiedDomains();

  // 设置保存代理配置按钮的行为
  document.getElementById('saveProxyConfig').addEventListener('click', function () {
    const server = document.getElementById('proxyServer').value.trim();
    const port = document.getElementById('proxyPort').value.trim();

    if (server && port) {
      chrome.runtime.sendMessage({
        action: "updateProxyConfig",
        config: { server, port },
        tabId: currentTabId // 包括当前标签页ID
      }, function (response) {
        if (response && response.success) {
          showMessage('代理配置已更新!');
        } else {
          showMessage('更新代理配置失败!', 'error');
        }
      });
    } else {
      showMessage('请输入有效的代理服务器和端口!', 'error');
    }
  });

  // 设置添加域名按钮
  document.getElementById('addDomain').addEventListener('click', function () {
    const domain = document.getElementById('newDomain').value.trim();
    if (domain) {
      addDomain(domain);
    } else {
      showMessage('请输入有效的域名!', 'error');
    }
  });

  // 设置清空所有域名按钮
  document.getElementById('clearAllDomains').addEventListener('click', function () {
    if (confirm('确定要清空所有被代理的域名吗?')) {
      chrome.storage.local.set({ proxiedDomains: [] }, function () {
        chrome.runtime.sendMessage({
          action: "updateProxyRules",
          tabId: currentTabId // 包括当前标签页ID
        }, function () {
          loadProxiedDomains();
          showMessage('所有代理域名已清空!');
        });
      });
    }
  });

  // 设置刷新当前页面按钮
  document.getElementById('refreshCurrentPage').addEventListener('click', function () {
    chrome.runtime.sendMessage({
      action: "reloadTab",
      tabId: currentTabId
    }, function (response) {
      if (response && response.success) {
        showMessage('页面刷新请求已发送!');
      } else {
        showMessage('页面刷新失败!', 'error');
      }
    });
  });

  // 设置导出域名列表按钮
  document.getElementById('exportDomains').addEventListener('click', function () {
    chrome.runtime.sendMessage({ action: "getProxiedDomains" }, function (domains) {
      if (Array.isArray(domains) && domains.length > 0) {
        // 创建要下载的JSON文件内容
        const dataStr = JSON.stringify({ proxiedDomains: domains }, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        // 创建下载链接
        const url = URL.createObjectURL(dataBlob);
        const downloadLink = document.createElement('a');
        const date = new Date().toISOString().split('T')[0];
        downloadLink.href = url;
        downloadLink.download = `proxy_domains_${date}.json`;

        // 触发下载
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        // 释放URL对象
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 100);

        showMessage('域名列表已导出!');
      } else {
        showMessage('没有域名可以导出!', 'info');
      }
    });
  });

  // 设置导入域名列表按钮
  document.getElementById('importDomains').addEventListener('click', function () {
    document.getElementById('importFile').click();
  });

  // 处理文件导入
  document.getElementById('importFile').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (event) {
      try {
        const data = JSON.parse(event.target.result);
        if (data && Array.isArray(data.proxiedDomains)) {
          chrome.storage.local.set({ proxiedDomains: data.proxiedDomains }, function () {
            chrome.runtime.sendMessage({
              action: "updateProxyRules",
              tabId: currentTabId
            }, function () {
              loadProxiedDomains();
              showMessage(`已导入 ${data.proxiedDomains.length} 个域名!`);
            });
          });
        } else {
          showMessage('文件格式无效!', 'error');
        }
      } catch (error) {
        console.log('导入失败:', error);
        showMessage('导入失败!', 'error');
      }

      // 重置文件输入，以便可以再次导入同一文件
      e.target.value = '';
    };

    reader.readAsText(file);
  });

  // Enter键添加域名
  document.getElementById('newDomain').addEventListener('keyup', function (event) {
    if (event.key === 'Enter') {
      document.getElementById('addDomain').click();
    }
  });

  // 加载高级设置
  loadAdvancedSettings();

  // 设置保存高级设置按钮的行为
  document.getElementById('saveAdvancedSettings').addEventListener('click', function () {
    saveAdvancedSettings();
  });

  // 设置高级设置折叠/展开功能
  const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
  const advancedSettingsContent = document.getElementById('advancedSettingsContent');
  const toggleIcon = advancedSettingsToggle.querySelector('.toggle-icon');
  
  // 默认是折叠状态，不需要额外设置
  
  advancedSettingsToggle.addEventListener('click', function() {
    const isExpanded = advancedSettingsContent.style.display === 'block';
    
    if (isExpanded) {
      // 折叠内容
      advancedSettingsContent.style.display = 'none';
      toggleIcon.textContent = '▼';
    } else {
      // 展开内容
      advancedSettingsContent.style.display = 'block';
      toggleIcon.textContent = '▲';
      
      // 展开时加载高级设置
      loadAdvancedSettings();
    }
  });
  
  // 设置保存高级设置按钮的行为
  document.getElementById('saveAdvancedSettings').addEventListener('click', function() {
    saveAdvancedSettings();
  });

});

// 加载被代理的域名列表
function loadProxiedDomains() {
  console.log('正在加载代理域名列表...');


  chrome.runtime.sendMessage({ action: "getProxiedDomains" }, function (domains) {
    if (chrome.runtime.lastError) {
      console.log('获取域名列表失败:', chrome.runtime.lastError);
      showMessage('加载域名列表失败', 'error');
      return;
    }

    const domainList = document.getElementById('domainList');
    domainList.innerHTML = '';

    // 确保 domains 是数组
    if (!Array.isArray(domains)) {
      console.log('接收到的域名列表不是有效数组:', domains);
      domains = [];
    }

    console.log('已加载域名列表:', domains);

    if (domains.length === 0) {
      const li = document.createElement('li');
      li.textContent = '没有被代理的域名';
      domainList.appendChild(li);
      return;
    }

    domains.forEach(domain => {
      const li = document.createElement('li');

      const domainSpan = document.createElement('span');
      domainSpan.textContent = domain;
      li.appendChild(domainSpan);

      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'domain-buttons';

      const removeButton = document.createElement('button');
      removeButton.textContent = '移除';
      removeButton.className = 'remove-btn';
      removeButton.onclick = function () {
        removeDomain(domain);
      };
      buttonsDiv.appendChild(removeButton);

      // 添加测试按钮
      const testButton = document.createElement('button');
      testButton.textContent = '测试';
      testButton.className = 'test-btn';
      testButton.onclick = function () {
        // 创建一个新标签页，导航到该域名
        chrome.tabs.create({ url: `https://${domain}` });
      };
      buttonsDiv.appendChild(testButton);

      li.appendChild(buttonsDiv);
      domainList.appendChild(li);
    });
  });
}

// 添加域名到被代理列表
function addDomain(domain) {
  domain = domain.trim().toLowerCase();
  if (!domain) {
    showMessage('请输入有效的域名!', 'error');
    return;
  }

  chrome.runtime.sendMessage({
    action: "addDomain",
    domain: domain
  }, function (response) {
    if (response && response.success) {
      // 刷新域名列表显示
      loadProxiedDomains();
      document.getElementById('newDomain').value = '';
      showMessage(`已添加 ${domain} 到代理列表`);

      // 如果需要刷新页面
      chrome.runtime.sendMessage({
        action: "reloadTab",
        tabId: currentTabId
      });
    } else {
      showMessage('添加域名失败: ' + (response ? response.reason : '未知错误'), 'error');
    }
  });
}

// 从被代理列表中移除域名
function removeDomain(domain) {
  console.log('尝试移除域名:', domain);

  // 获取当前标签页ID
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    let tabId = null;
    if (tabs && tabs.length > 0) {
      tabId = tabs[0].id;
    }

    chrome.runtime.sendMessage({
      action: "removeDomain",
      domain: domain,
      tabId: tabId // 包括当前标签页ID
    }, function (response) {
      if (chrome.runtime.lastError) {
        console.log('移除域名失败:', chrome.runtime.lastError);
        showMessage(`移除 ${domain} 失败`, 'error');
        return;
      }

      if (response && response.success) {
        console.log('域名已移除:', domain);
        loadProxiedDomains();
        showMessage(`已从代理列表中移除 ${domain}`);
      } else {
        console.log('移除域名失败:', domain);
        showMessage(`移除 ${domain} 失败`, 'error');
      }
    });
  });
}

// 加载高级设置
function loadAdvancedSettings() {
  chrome.runtime.sendMessage({action: "getExtensionSettings"}, function(settings) {
    if (chrome.runtime.lastError) {
      console.log('获取设置失败:', chrome.runtime.lastError);
      return;
    }
    
    if (settings) {
      document.getElementById('testDomain').value = settings.testDomain || 'www.google.com';
      document.getElementById('testEndpoint').value = settings.testEndpoint || '/generate_204';
      document.getElementById('testTimeout').value = settings.testTimeout || 10000;
    }
  });
}

// 保存高级设置
function saveAdvancedSettings() {
  const testDomain = document.getElementById('testDomain').value.trim() || 'www.google.com';
  const testEndpoint = document.getElementById('testEndpoint').value.trim() || '/generate_204';
  const testTimeoutInput = document.getElementById('testTimeout').value.trim();
  const testTimeout = parseInt(testTimeoutInput) || 10000;
  
  const settings = {
    testDomain: testDomain,
    testEndpoint: testEndpoint,
    testTimeout: testTimeout
  };
  
  chrome.runtime.sendMessage({
    action: "updateExtensionSettings",
    settings: settings
  }, function(response) {
    if (response && response.success) {
      showMessage('高级设置已保存!');
    } else {
      showMessage('保存设置失败!', 'error');
    }
  });
}

// 显示消息
function showMessage(message, type = 'success') {
  // 查找是否已存在消息元素
  let messageDiv = document.querySelector('.message');

  // 如果不存在则创建一个新的
  if (!messageDiv) {
    messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    document.body.insertBefore(messageDiv, document.body.firstChild);
  } else {
    // 如果已存在则更新类型
    messageDiv.className = `message ${type}`;
  }

  // 设置消息内容
  messageDiv.textContent = message;
  console.log('显示消息:', message, type);

  // 淡入效果
  messageDiv.style.opacity = '1';

  // 3秒后淡出并移除消息
  setTimeout(() => {
    messageDiv.style.opacity = '0';
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.parentNode.removeChild(messageDiv);
      }
    }, 300);
  }, 3000);
}