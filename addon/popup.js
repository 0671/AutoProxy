document.addEventListener('DOMContentLoaded', function () {
  // 当前标签页ID
  let currentTabId = null;
  let pluginEnabled = true; // 插件启用状态

  // 获取当前标签页ID
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs && tabs.length > 0) {
      currentTabId = tabs[0].id;
    }
  });

  // 状态指示器和文本元素
  const statusIndicator = document.getElementById('proxyStatusIndicator');
  const statusText = document.getElementById('proxyStatusText');
  const proxyConfigAlert = document.getElementById('proxyConfigAlert');
  const pluginStatus = document.getElementById('pluginStatus');

  // 检查插件状态
  chrome.runtime.sendMessage({ action: "getPluginStatus" }, function (response) {
    if (response && response.enabled === false) {
      pluginEnabled = false;
      updatePluginStatusUI();
    }
  });

  // 初始状态设置为未知
  updateProxyStatus('unknown');


  // 加载代理配置
  chrome.runtime.sendMessage({ action: "getProxyConfig" }, function (config) {
    if (config.server) {
      document.getElementById('proxyServer').value = config.server;
    }
    if (config.port) {
      document.getElementById('proxyPort').value = config.port;
    }

    // 检查是否配置了代理
    if (!config || !config.server || !config.port) {
      proxyConfigAlert.style.display = 'block';
    } else {
      proxyConfigAlert.style.display = 'none';
      // 如果有配置则测试代理可用性
      testProxyAvailability(config.server, config.port);
    }
  });

  // 加载被代理的域名列表
  loadProxiedDomains();

  // 设置保存代理配置按钮的行为
  document.getElementById('saveProxyConfig').addEventListener('click', function () {
    const server = document.getElementById('proxyServer').value;
    const port = document.getElementById('proxyPort').value;

    if (server && port) {
      updateProxyStatus('unknown');

      chrome.runtime.sendMessage({
        action: "updateProxyConfig",
        config: { server, port }
      }, function (response) {
        if (response.success) {
          showMessage('代理配置已更新!');
          // 如果插件之前被禁用，现在启用它
          if (!pluginEnabled) {
            enablePlugin();
          }

          // 保存后测试代理可用性
          testProxyAvailability(server, port);

        } else {
          showMessage('更新代理配置失败!', 'error');
        }
      });
    } else {
      proxyConfigAlert.style.display = 'block';
    }
  });

  // 设置测试代理按钮行为
  document.getElementById('testProxyBtn').addEventListener('click', function () {
    const server = document.getElementById('proxyServer').value.trim();
    const port = document.getElementById('proxyPort').value.trim();

    if (server && port) {
      updateProxyStatus('unknown');
      testProxyAvailability(server, port, true);
    } else {
      showMessage('请输入代理服务器和端口进行测试', 'info');
    }
  });

  // 设置刷新当前页面按钮
  document.getElementById('refreshCurrentPage').addEventListener('click', function () {
    if (currentTabId) {
      chrome.runtime.sendMessage({
        action: "reloadTab",
        tabId: currentTabId
      }, function () {
        showMessage('页面已刷新!');
      });
    }
  });

  // 设置禁用插件按钮
  document.getElementById('disablePlugin').addEventListener('click', function () {
    if (pluginEnabled) {
      disablePlugin();
    } else {
      enablePlugin();
    }
  });

  // 设置打开选项页面的按钮
  document.getElementById('openOptions').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  // 禁用插件功能
  function disablePlugin() {
    chrome.runtime.sendMessage({ action: "disablePlugin" }, function (response) {
      if (response && response.success) {
        pluginEnabled = false;
        updatePluginStatusUI();
        showMessage('插件已禁用，当前浏览器使用系统代理设置');
      }
    });
  }

  // 启用插件功能
  function enablePlugin() {
    chrome.runtime.sendMessage({ action: "enablePlugin" }, function (response) {
      if (response && response.success) {
        pluginEnabled = true;
        updatePluginStatusUI();
        showMessage('插件已启用');
      }
    });
  }

  // 更新插件状态UI
  function updatePluginStatusUI() {
    const disableBtn = document.getElementById('disablePlugin');

    if (pluginEnabled) {
      pluginStatus.textContent = '插件已启用';
      pluginStatus.className = 'plugin-status plugin-enabled';
      disableBtn.textContent = '禁用插件';
    } else {
      pluginStatus.textContent = '插件已禁用 (使用系统代理)';
      pluginStatus.className = 'plugin-status plugin-disabled';
      disableBtn.textContent = '启用插件';
    }
  }


  // 测试代理可用性
  function testProxyAvailability(server, port, needShowMessage = false) {
    updateProxyStatus('testing');

    // 禁用测试按钮，避免重复点击
    const testButton = document.getElementById('testProxyBtn');
    testButton.disabled = true;
    testButton.textContent = '测试中...';

    // 获取当前的测试域名设置
    chrome.runtime.sendMessage({ action: "getExtensionSettings" }, function (settings) {
      const testDomain = settings && settings.testDomain ? settings.testDomain : 'www.google.com';

      // 显示正在测试的域名
      const statusText = document.getElementById('proxyStatusText');
      statusText.textContent = `正在测试 ${testDomain}...`;

      // 发送消息到背景脚本，测试代理可用性
      chrome.runtime.sendMessage({
        action: "testProxyAvailability",
        server: server,
        port: port
      }, function (response) {
        // 恢复测试按钮
        testButton.disabled = false;
        testButton.textContent = '测试代理';

        // 更新状态显示
        if (response && response.success) {
          updateProxyStatus('available');
          // showMessage(`代理访问 ${testDomain} 成功!`);
        } else {
          updateProxyStatus('unavailable');
          const errorMsg = response && response.error ? response.error : '未知错误';
          if (needShowMessage) {
            showMessage(`代理访问 ${testDomain} 失败: ${errorMsg}`, 'error');
          }
        }
      });
    });
  }

  // 更新代理状态指示器
  function updateProxyStatus(status) {
    // 移除所有状态类
    statusIndicator.className = 'status-indicator';

    switch (status) {
      case 'available':
        statusIndicator.classList.add('status-available');
        statusText.textContent = '代理可用';
        break;
      case 'unavailable':
        statusIndicator.classList.add('status-unavailable');
        statusText.textContent = '代理不可用';
        break;
      case 'testing':
        statusIndicator.classList.add('status-unknown');
        statusText.textContent = '测试中...';
        break;
      case 'error':
        statusIndicator.classList.add('status-error');
        statusText.textContent = '测试出错';
        break;
      default:
        statusIndicator.classList.add('status-unknown');
        statusText.textContent = '状态未知';
    }
  }

});

// 加载被代理的域名列表
function loadProxiedDomains() {
  chrome.runtime.sendMessage({ action: "getProxiedDomains" }, function (domains) {
    const domainList = document.getElementById('domainList');
    domainList.innerHTML = '';

    // 确保 domains 是数组
    if (!Array.isArray(domains)) {
      domains = [];
      console.error('接收到的域名列表不是有效数组');
    }

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

      const removeButton = document.createElement('button');
      removeButton.textContent = '移除';
      removeButton.className = 'remove-btn';
      removeButton.onclick = function () {
        removeDomain(domain);
      };
      li.appendChild(removeButton);

      domainList.appendChild(li);
    });
  });
}

// 从被代理列表中移除域名
function removeDomain(domain) {
  chrome.runtime.sendMessage({
    action: "removeDomain",
    domain: domain
  }, function (response) {
    if (response.success) {
      loadProxiedDomains();
      showMessage(`已从代理列表中移除 ${domain}`);
    } else {
      showMessage(`移除 ${domain} 失败`, 'error');
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
    document.body.appendChild(messageDiv);
  } else {
    // 如果已存在则更新类型
    messageDiv.className = `message ${type}`;
  }

  // 设置消息内容
  messageDiv.textContent = message;

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