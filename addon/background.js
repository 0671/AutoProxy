// 存储被代理的域名列表
let proxiedDomains = [];
let proxyConfig = {};
// 其他配置
let extensionSettings = {
    testDomain: 'www.google.com',    // 默认测试域名
    testEndpoint: '/generate_204',   // 默认测试端点
    testTimeout: 10000               // 默认超时时间(毫秒)
};
// 插件启用状态
let pluginEnabled = true;

// 代理pac脚本模版
const pacTemplate = `
function FindProxyForURL(url, host) {
    const includeDomains = '{PROXYED_DOMAINS_STR}';

    const includeList = includeDomains.split(';');

    for (let i = 0; i < includeList.length; i++) {
        let domainPattern = includeList[i].trim();
        if (domainPattern && shExpMatch(host, domainPattern)) {
            return "PROXY {PROXY_SERVER}";
        }
    }

    return "DIRECT";
}
`;

// 初始化加载数据
function loadStoredData() {
    // 初始化，从存储中加载数据
    chrome.storage.local.get(['proxiedDomains', 'proxyConfig', 'extensionSettings'], function (result) {
        if (result.proxiedDomains && Array.isArray(result.proxiedDomains)) {
            proxiedDomains = result.proxiedDomains;
        } else {
            // 确保 proxiedDomains 始终是数组
            proxiedDomains = [];
            chrome.storage.local.set({ proxiedDomains: [] });
        }

        console.log('已从存储加载代理域名:', proxiedDomains);
        updateProxyRules();

        // 加载代理配置
        if (result.proxyConfig) {
            proxyConfig = result.proxyConfig;
        } else {
            proxyConfig = {
                server:'192.168.10.100',
                port:'8085'
            };
        }

        // 加载扩展设置，或使用默认值
        if (result.extensionSettings) {
            // 合并默认设置和已保存设置
            extensionSettings = Object.assign({}, extensionSettings, result.extensionSettings);
        } else {
            // 如果没有保存的设置，使用默认值
            chrome.storage.local.set({ extensionSettings: extensionSettings });
        }
        console.log('从存储加载扩展设置:', extensionSettings);
    });
}

// 监听存储变更
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
        if (changes.proxiedDomains) {
            console.log('存储中的代理域名已更新:',
                'Old value:', changes.proxiedDomains.oldValue,
                'New value:', changes.proxiedDomains.newValue);
            proxiedDomains = changes.proxiedDomains.newValue || [];
            updateProxyRules();
        }
        if (changes.proxyConfig) {
            console.log('存储中的代理配置已更新');
            proxyConfig = changes.proxyConfig.newValue || {};
            updateProxyRules();
        }
    }
});

// 初始化时加载数据
loadStoredData();

// 检查标签页是否是正常标签页(非插件页面)
function isNormalTab(details, callback) {
    console.log('--------')
    console.log(details.tabId)
    console.log(details.url)
    // 如果没有关联的标签页，则不处理
    if (!details.tabId || details.tabId === -1) {
        callback(false);
        return;
    }

    // 通过tab ID检查标签页URL
    chrome.tabs.get(details.tabId, function(tab) {
        if (chrome.runtime.lastError) {
            // 如果获取标签页失败，不处理
            console.log('获取便签页失败')
            callback(false);
            return;
        }

        // 检查标签页URL是否是插件页面或特殊页面
        const isNormal = tab && tab.url && 
            !tab.url.startsWith('chrome://') && // chrome配置页面
            !tab.url.startsWith('chrome-extension://') && // 插件页面
            !tab.url.startsWith('about:') &&
            !tab.url.startsWith('devtools://'); // 调试页面
        
        callback(isNormal);
    });
}

function handleAutoProxy(details, reason) {
    isNormalTab(details, function(isNormal) {
        if (!isNormal) {
            console.log(`忽略非正常标签页的403或超时请求: ${details.url}`);
            return;
        }

        if (!pluginEnabled) return;
        if (!proxyConfig.server || !proxyConfig.port) return;

        const url = new URL(details.url);
        const domain = url.hostname;

        if (!proxiedDomains.includes(domain)) {
            proxiedDomains.push(domain);
            chrome.storage.local.set({ proxiedDomains: proxiedDomains });
            updateProxyRules();

            let msg = reason === '403' ? '因为检测到 403 错误' : '因为访问超时';
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'img/icons/icon-48.png',
                title: '代理已启用',
                message: `已为 ${domain} 启用代理，${msg}`
            });

            if (details.tabId && details.tabId !== -1) {
                setTimeout(() => {
                    try {
                        chrome.tabs.reload(details.tabId);
                    } catch (e) {}
                }, 500);
            }
        }
    })
}

// 403
chrome.webRequest.onCompleted.addListener(
    function (details) {
        if (details.statusCode === 403) {
            handleAutoProxy(details, '403');
        }
    },
    { urls: ["<all_urls>"] }
);

// 超时
chrome.webRequest.onErrorOccurred.addListener(
    function (details) {
        if (details.error === "net::ERR_TIMED_OUT") {
            handleAutoProxy(details, 'timeout');
        }
    },
    { urls: ["<all_urls>"] }
);

// 生成代理pac文本
function generatePacScript(proxiedDomains, proxyConfig) {
    let proxiedDomainsStr = proxiedDomains.join(';');
    let proxyServer = `${proxyConfig.server}:${proxyConfig.port}`;
    return pacTemplate
        .replace('{PROXYED_DOMAINS_STR}', proxiedDomainsStr)
        .replace('{PROXY_SERVER}', proxyServer);
}

// 刷新指定的标签页，如果未提供tabId则刷新当前活动标签页
function reloadTab(tabId = null) {
    // 如果提供了特定tabId
    if (tabId !== null) {
        chrome.tabs.get(tabId, function (tab) {
            if (!chrome.runtime.lastError && tab) {
                // 只刷新http和https页面
                // if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
                chrome.tabs.reload(tabId);
                console.log('已通过reloadTab刷新标签页:', tab.url);
                // }
            }
        });
        return;
    }

    // 否则刷新当前活动标签页
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs && tabs.length > 0) {
            const activeTab = tabs[0];
            // 只刷新http和https页面，避免刷新chrome://扩展页面
            if (activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
                chrome.tabs.reload(activeTab.id);
                console.log('已刷新当前标签页:', activeTab.url);
            }
        }
    });
}

// 禁用插件
function disablePlugin() {
    pluginEnabled = false;

    // 恢复系统代理设置
    chrome.proxy.settings.set({
        value: { mode: "system" },
        scope: 'regular'
    }, function () {
        console.log('已禁用插件，使用系统代理设置');
    });
}

// 启用插件
function enablePlugin() {
    pluginEnabled = true;

    // 重新应用代理规则
    updateProxyRules();
    console.log('已启用插件');
}


// 更新代理规则
function updateProxyRules(shouldReloadActiveTab = false) {
    // 如果插件被禁用，不执行任何操作
    if (!pluginEnabled) {
        console.log('插件已禁用，不更新代理规则');
        return;
    }
    // 如果没有配置代理，不执行任何操作
    if (!proxyConfig.server || !proxyConfig.port) {
        return;
    }

    // 应用代理规则
    if (proxiedDomains.length > 0) {
        proxyScript = generatePacScript(
            proxiedDomains,
            proxyConfig
        );
        console.log(proxyScript);
        chrome.proxy.settings.set(
            { value: { mode: "pac_script", pacScript: { data: proxyScript } }, scope: 'regular' },
            function (result) {
                if (chrome.runtime.lastError) {
                    console.log('设置代理失败:', chrome.runtime.lastError);
                } else {
                    console.log('已更新代理规则');
                    // 如果需要刷新当前标签页
                    if (shouldReloadActiveTab) {
                        reloadActiveTab();
                    }
                }
            }
        );
    } else {
        // 如果没有被代理的域名，使用直连
        chrome.proxy.settings.set(
            { value: { mode: "direct" }, scope: 'regular' }
        );
    }
}

// 测试代理可用性
function testProxyAvailability(server, port, callback) {
    const proxyUrl = `${server}:${port}`;
    console.log(`测试代理可用性: ${proxyUrl}`);

    // 使用配置的测试域名
    const testDomain = extensionSettings.testDomain || 'www.google.com';
    const testEndpoint = extensionSettings.testEndpoint || '/generate_204';
    const testTimeout = extensionSettings.testTimeout || 10000;

    // 保存当前代理配置
    const originalProxyRules = proxyConfig;
    const originalProxiedDomains = [...proxiedDomains];

    // 创建临时测试配置
    let testProxyConfig = { server, port };
    let testProxiedDomains = [testDomain];

    // 应用临时代理设置
    proxyConfig = testProxyConfig;
    proxiedDomains = testProxiedDomains;

    // 创建特殊的PAC脚本，只对测试域名使用代理
    let testPacScript = generatePacScript(testProxiedDomains, testProxyConfig);
    let testProxySettings = {
        mode: "pac_script",
        pacScript: {
            data: testPacScript
        }
    };

    // 应用测试代理设置
    chrome.proxy.settings.set(
        { value: testProxySettings, scope: 'regular' },
        function () {
            if (chrome.runtime.lastError) {
                console.log('设置测试代理失败:', chrome.runtime.lastError);
                restoreProxySettings();
                callback({ success: false, error: '设置代理失败' });
                return;
            }

            // 设置超时
            const timeoutId = setTimeout(function () {
                console.log('代理测试超时');
                restoreProxySettings();
                callback({ success: false, error: '测试超时' });
            }, testTimeout);

            // 使用 fetch API 发起测试请求
            console.log('开始测试代理连接...');

            // 使用带随机参数的URL避免缓存
            const random = Math.random().toString().substring(2);
            const testUrl = `https://${testDomain}${testEndpoint}?r=${random}`;

            fetch(testUrl, {
                method: 'HEAD',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            })
                .then(response => {
                    clearTimeout(timeoutId);
                    restoreProxySettings();

                    console.log(`代理测试成功，状态码: ${response.status}`)
                    callback({  success: true,  statusCode: response.status  });
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    restoreProxySettings();
                    console.log('代理测试错误:', error.message);
                    callback({ success: false, error: error.message });
                });
        }
    );

    // 恢复原来的代理设置的函数
    function restoreProxySettings() {
        proxyConfig = originalProxyRules;
        proxiedDomains = originalProxiedDomains;
        updateProxyRules();
    }
}


// 监听消息，用于与弹出窗口通信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "disablePlugin") {
        disablePlugin();
        sendResponse({ success: true });
    } else if (message.action === "enablePlugin") {
        enablePlugin();
        sendResponse({ success: true });
    } else if (message.action === "getPluginStatus") {
        sendResponse({ enabled: pluginEnabled });
    } else if (message.action === "getProxiedDomains") {
        // 确保返回的是数组
        sendResponse(Array.isArray(proxiedDomains) ? proxiedDomains : []);
    } else if (message.action === "getExtensionSettings") {
        sendResponse(extensionSettings);
    } else if (message.action === "updateExtensionSettings") {
        // 更新设置
        extensionSettings = Object.assign({}, extensionSettings, message.settings);
        // 保存到存储
        chrome.storage.local.set({ extensionSettings: extensionSettings });
        sendResponse({ success: true });
    } else if (message.action === "testProxyAvailability") {
        testProxyAvailability(message.server, message.port, sendResponse);
        return true; // 表明我们会异步调用 sendResponse
    } else if (message.action === "addDomain") {
        if (message.domain && !proxiedDomains.includes(message.domain)) {
            proxiedDomains.push(message.domain);
            chrome.storage.local.set({ proxiedDomains: proxiedDomains });
            sendResponse({ success: true, domains: proxiedDomains });
        } else {
            sendResponse({ success: false, reason: "域名无效或已存在" });
        }
    } else if (message.action === "removeDomain") {
        const index = proxiedDomains.indexOf(message.domain);
        if (index !== -1) {
            proxiedDomains.splice(index, 1);
            chrome.storage.local.set({ proxiedDomains: proxiedDomains });
            updateProxyRules();

            // 如果指定了tabId，刷新该标签页
            if (message.tabId) {
                reloadTab(message.tabId);
            }

            sendResponse({ success: true });
        } else {
            sendResponse({ success: false });
        }
    } else if (message.action === "updateProxyConfig") {
        proxyConfig = message.config;
        chrome.storage.local.set({ proxyConfig: proxyConfig });
        updateProxyRules();
        // 如果指定了tabId，刷新该标签页
        if (message.tabId) {
            reloadTab(message.tabId);
        }
        sendResponse({ success: true });
    } else if (message.action === "getProxyConfig") {
        sendResponse(proxyConfig || {});
    } else if (message.action === "updateProxyRules") {
        updateProxyRules();

        // 如果指定了tabId，刷新该标签页
        if (message.tabId) {
            reloadTab(message.tabId);
        }

        sendResponse({ success: true });
    } else if (message.action === "reloadTab") {
        const tabIdToReload = message.tabId || null; // 可以指定特定标签或默认当前活动标签
        reloadTab(tabIdToReload);
        sendResponse({ success: true });
    }
    return true; // 确保异步响应正常工作
});

// 当扩展安装或更新时初始化
chrome.runtime.onInstalled.addListener(() => {
    updateProxyRules();
});