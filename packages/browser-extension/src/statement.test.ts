// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { extractStatementMarkdown } from "./statement";

describe("problem statement extraction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts Nowcoder's statement without editor controls", () => {
    document.body.innerHTML = `
      <div class="js-left"><div class="terminal-topic">
        <div>                        时间限制：C++ 2秒，其他语言4秒</div>
        <div>            空间限制：C++ 256 M，其他语言512 M</div>
        <div>             64bit IO Format: %lld</div>
        <h2>题目描述</h2><div>        链接</div>
        <p onclick="alert(1)">求两数之和，第$i$种字符出现$a_i$次</p>
        <h2>输入描述:</h2><pre>第一行输入整数<span class="MathJax_Preview">n</span><span class="MathJax"><span>n</span><span>n</span></span><script type="math/tex">n</script> (<span class="MathJax_Preview">1≤n≤2⋅105</span><span class="MathJax"><span>1≤n≤2⋅105</span><span>1≤n≤2⋅105</span></span><script type="math/tex">1\\le n \\le 2\\cdot 10^5</script>)，表示字符种数。第二行输入<span class="MathJax_Preview">n</span><span class="MathJax"><span>n</span><span>n</span></span><script type="math/tex">n</script>个整数<span class="MathJax_Preview">ai</span><span class="MathJax"><span>ai</span><span>ai</span></span><script type="math/tex">a_i</script> (<span class="MathJax_Preview">1≤ai≤109</span><span class="MathJax"><span>1≤ai≤109</span><span>1≤ai≤109</span></span><script type="math/tex">1\\le a_i \\le 10^9</script>)。</pre>
        <div>示例1</div><h2>输入</h2><pre>1 0\n</pre><h2>输出</h2><pre>1\n</pre>
        <h2>说明</h2><pre>三种字符的编码分别为<br>["00","01","1"]<br>时，长度最短。</pre>
        <img src="/equation?tex=n" alt="n"><a href="/acm/problem/1">原题</a>
        <button>复制</button><script>globalThis.bad = true</script>
      </div></div><div class="CodeMirror">editor</div>`;
    const markdown = extractStatementMarkdown("nowcoder", document, "https://ac.nowcoder.com/acm/problem/1")!;
    expect(markdown).toContain("## 题目描述");
    expect(markdown).toContain("求两数之和");
    expect(markdown).toContain("$n$");
    expect(markdown).not.toContain("equation?tex=n");
    expect(markdown).not.toMatch(/script|onclick|button|CodeMirror/i);
    expect(markdown).toMatch(/^时间限制：C\+\+ 2秒，其他语言4秒$/m);
    expect(markdown).toMatch(/^空间限制：C\+\+ 256 M，其他语言512 M$/m);
    expect(markdown).not.toMatch(/^\s+时间限制/m);
    expect(markdown).not.toMatch(/^\s*链接\s*$/m);
    expect(markdown).not.toContain("复制");
    expect(markdown).toContain("$a_i$");
    expect(markdown).toContain("第一行输入整数$n$ ($1\\le n \\le 2\\cdot 10^5$)，表示字符种数。\n第二行输入$n$个整数$a_i$ ($1\\le a_i \\le 10^9$)。");
    expect(markdown).not.toMatch(/nnn|1≤n≤2⋅105|aia_i/);
    expect(markdown).not.toContain("```\n第一行输入");
    expect(markdown).toContain("## 示例 1");
    expect(markdown).toMatch(/<strong>输入<\/strong>\n+```\n1 0\n```/);
    expect(markdown).toMatch(/<strong>输出<\/strong>\n+```\n1\n```/);
    expect(markdown).not.toContain("## 输入\n");
    expect(markdown).not.toContain("1 0\n\n```");
    expect(markdown).toContain('三种字符的编码分别为 ["00", "01", "1"] 时，长度最短。');
  });

  it("rejects executable and non-http links", () => {
    document.body.innerHTML = `<article><h1>题目</h1><p>${"内容".repeat(20)}</p>
      <a href="javascript:alert(1)">坏链接</a><iframe src="https://evil.example"></iframe></article>`;
    const markdown = extractStatementMarkdown("luogu", document, "https://www.luogu.com.cn/problem/P1")!;
    expect(markdown).toContain("坏链接");
    expect(markdown).not.toMatch(/javascript:|iframe/i);
  });

  it("extracts LeetCode and YBT statement containers", () => {
    document.body.innerHTML = `<div data-track-load="description_content"><h2>题目描述</h2>
      <p>给定字符串 <code>s</code>，找出其中不含重复字符的 <strong>最长</strong><strong><button type="button">子串</button>的长度。</strong></p>
      <p><strong>目标值</strong><em><code>target</code></em>，**进阶： **你可以求 <code>O(n<sup>2</sup>)</code>，范围 <code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code>，元素 a<sub>i</sub>。</p>
      <p>数字按照** 逆序 **的方式存储，每个节点只能存储** 一位**数字。</p>
      <p>复杂度为 <code>O(<span class="katex"><span class="katex-html">log<span>2</span>(m+n)</span></span>)</code>。</p>
      <pre>nums = [2,7]</pre></div>`;
    const leetcode = extractStatementMarkdown("leetcode", document, "https://leetcode.cn/problems/two-sum/")!;
    expect(leetcode).toContain("nums = [2,7]");
    expect(leetcode).toContain("<strong>进阶：</strong> 你可以");
    expect(leetcode).toContain("<strong>最长</strong><strong>子串的长度。</strong>");
    expect(leetcode).not.toContain("****");
    expect(leetcode).toContain("按照 <strong>逆序</strong> 的方式");
    expect(leetcode).toContain("存储 <strong>一位</strong> 数字");
    expect(leetcode).not.toContain("\\*\\*");
    expect(leetcode).toContain("<strong>目标值</strong><em>`target`</em>");
    expect(leetcode).not.toContain("***`target`");
    expect(leetcode).toContain("$O(n^{2})$");
    expect(leetcode).toContain("$2 \\le nums.length \\le 10^{4}$");
    expect(leetcode).toContain("aᵢ");
    expect(leetcode).toContain("$O(\\log_{2}(m+n))$");
    expect(leetcode).not.toContain("O(log2");

    document.body.innerHTML = `<div id="problem"><h1>汉诺塔</h1><p>${"题目内容".repeat(10)}</p></div>`;
    expect(extractStatementMarkdown("ybt", document, "http://ybt.ssoier.cn:8088/problem_show.php?pid=1"))
      .toContain("汉诺塔");
  });

  it("extracts Luogu's hydration data after the IDE removes the article", () => {
    const context = {
      data: {
        problem: {
          content: {
            description: "给出一个长度为 $n$ 的序列。",
            formatI: "输入整数 $n$。",
            formatO: "输出答案。",
            hint: "保证 $n \\le 10^5$。"
          },
          samples: [["3\n1 2 3", "6"]]
        }
      }
    };
    document.body.innerHTML = `<div id="app"><div class="CodeMirror"></div></div>
      <script id="lentille-context" type="application/json">${JSON.stringify(context)}</script>`;
    const markdown = extractStatementMarkdown("luogu", document, "https://www.luogu.com.cn/problem/P1115")!;
    expect(markdown).toContain("## 题目描述");
    expect(markdown).toContain("## 样例 1 输入");
    expect(markdown).toContain("1 2 3");
    expect(markdown).toContain("$n$");
    expect(markdown).toContain("\\le");
    expect(markdown).not.toContain("CodeMirror");
  });

  it("prefers Luogu's original Markdown over its rendered article", () => {
    const context = {
      data: { problem: { content: { description: "原始公式 $a_i$ 与 **强调**。" } } }
    };
    document.body.innerHTML = `<article><p>${"渲染后的文字".repeat(10)}</p></article>
      <script id="lentille-context" type="application/json">${JSON.stringify(context)}</script>`;
    const markdown = extractStatementMarkdown("luogu", document, "https://www.luogu.com.cn/problem/P3")!;
    expect(markdown).toContain("原始公式 $a_i$");
    expect(markdown).toContain("**强调**");
    expect(markdown).not.toContain("渲染后的文字");
  });

  it("converts tables and removes executable markup", () => {
    document.body.innerHTML = `<article><h1>统计</h1><p>${"说明".repeat(10)}</p>
      <table><tr><th>输入</th><th>输出</th></tr><tr><td>1</td><td>2</td></tr></table>
      <script>alert(1)</script></article>`;
    const markdown = extractStatementMarkdown("luogu", document, "https://www.luogu.com.cn/problem/P2")!;
    expect(markdown).toContain("| 输入 | 输出 |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).not.toContain("alert");
  });
});
