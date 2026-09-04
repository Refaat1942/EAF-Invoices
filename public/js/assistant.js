/**
 * مساعد مرشد — إجابات قواعد بالعامية المصرية.
 */
(function () {
  const FAQ = [
    {
      keys: ['سجل مريض', 'تسجيل مريض', 'مريض جديد', 'افتح ملف', 'ملف جديد'],
      answer:
        'من الرئيسية → «تسجيل مريض جديد». اختار داخلي أو خارجي، املأ البيانات الأساسية ورقم الملف. بعد التسجيل هتتحول لحركة المريض اليومية وتتفتح فاتورة تلقائي.',
    },
    {
      keys: ['تحصيل', 'محصل', 'فلوس', 'دفع نقد', 'خصم من رصيد', 'رصيد مريض'],
      answer:
        'التحصيل ممكن يكون نقدي أو تحويل أو شيك، أو «خصم من رصيد المريض». خصم الرصيد مش كاش — بيخصم من رصيد المريض المسجّل. في مراجعة الفاتورة من الحركة اليومية المدفوعات يدوية.',
    },
    {
      keys: ['فاتورة كبيرة', 'مراجعة فاتورة', 'اعتماد', 'مسودة', 'ارسل للمراجعة'],
      answer:
        'الفاتورة الكبيرة بتتفتح من حركة المريض. احفظ مؤقت، وبعدين أرسل للمراجعة، والمراجع يعتمدها. بعد الاعتماد مفيش تعديل — بس طباعة وPDF.',
    },
    {
      keys: ['حركة يومية', 'ادوية', 'مستلزمات', 'اقامة', 'حركة المريض'],
      answer:
        'من الرئيسية → حركة المريض. اختار المريض وسجّل البنود يوم بيوم (أدوية، مستلزمات، إقامة...). البنود بتتزامن تلقائي مع الفاتورة الكبيرة.',
    },
    {
      keys: ['رصيد بعد', 'رصيد الحساب', '100', 'متبقي الدفع'],
      answer:
        '«رصيد الحساب» هو رصيد المريض الحالي. «إجمالي الفاتورة» هو اللي هيتخصم. «رصيد بعد الفاتورة» = الرصيد ناقص إجمالي الفاتورة. «متبقي الدفع» هو اللي لسه مطلوب يتسدد على الفاتورة نفسها.',
    },
    {
      keys: ['مش متوازن', 'نقص دفع', 'زيادة دفع', 'متبقي الدفع'],
      answer:
        'لازم مجموع طرق الدفع = إجمالي الفاتورة. شوف تفصيل المدفوع تحت جدول الدفع. لو في خصم رصيد بس، ده مش نقدي.',
    },
    {
      keys: ['طباعة', 'معاينة', 'pdf'],
      answer:
        'في الفاتورة الكبيرة اضغط «معاينة طباعة» عشان تشوف شكل الفاتورة. PDF وWord بيظهروا بعد الاعتماد النهائي.',
    },
    {
      keys: ['تنبيه', 'جرس', 'audit', 'تدقيق', 'مراقبة النظام'],
      answer:
        'الجرس 🔔 للمسؤول بيعرض تنبيهات النظام. سجل التدقيق في الإعدادات → مراقبة النظام بيسجّل كل الإجراءات المهمة.',
    },
  ];

  const DEFAULT_ANSWER =
    'اسألني عن: تسجيل مريض، حركة يومية، الفاتورة، التحصيل، الرصيد، أو الطباعة.';

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[؟?،,.]/g, ' ')
      .replace(/أ|إ|آ/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreMatch(question, item) {
    let score = 0;
    for (const key of item.keys) {
      const k = normalize(key);
      if (!k) continue;
      if (question.includes(k)) score += k.split(' ').length + 2;
    }
    return score;
  }

  function findAnswer(question) {
    const q = normalize(question);
    if (!q) return DEFAULT_ANSWER;

    let best = null;
    let bestScore = 0;
    for (const item of FAQ) {
      const score = scoreMatch(q, item);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (best && bestScore > 0) return best.answer;

    if (q.includes('ازاي') || q.includes('إزاي')) {
      if (q.includes('مريض') || q.includes('سجل') || q.includes('ملف')) {
        return FAQ[0].answer;
      }
      return 'قولّي عايز تعمل إيه: تسجيل مريض؟ حركة يومية؟ فاتورة؟ دفع؟ طباعة؟';
    }
    return DEFAULT_ANSWER;
  }

  function appendMessage(container, text, role) {
    const div = document.createElement('div');
    div.className = `assistant-msg assistant-msg--${role}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function bindAssistant() {
    const toggle = document.getElementById('assistant-toggle');
    const panel = document.getElementById('assistant-panel');
    const closeBtn = document.getElementById('assistant-close');
    const form = document.getElementById('assistant-form');
    const input = document.getElementById('assistant-input');
    const messages = document.getElementById('assistant-messages');
    if (!toggle || !panel || !form || !messages) return;

    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !messages.dataset.welcomed) {
        messages.dataset.welcomed = '1';
        appendMessage(messages, 'أهلاً! أنا مساعدك في النظام. اسألني عن أي خطوة محتاجها.', 'bot');
      }
      if (open) input.focus();
    });
    closeBtn?.addEventListener('click', () => {
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      appendMessage(messages, text, 'user');
      input.value = '';
      setTimeout(() => appendMessage(messages, findAnswer(text), 'bot'), 200);
    });
  }

  window.initAssistant = function initAssistant() {
    bindAssistant();
  };
})();
