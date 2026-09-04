/**
 * مساعد مرشد — إجابات قواعد بالعامية المصرية (بدون API خارجي).
 */
(function () {
  const FAQ = [
    {
      keys: ['تحصيل', 'محصل', 'فلوس', 'دفع', 'رصيد مريض', 'خصم'],
      answer:
        'التحصيل ممكن يكون نقدي أو تحويل أو شيك، أو «خصم من رصيد المريض». خصم الرصيد مش كاش — بيخصم من رصيد المريض المسجّل. في مراجعة الفاتورة من الحركة اليومية المدفوعات يدوية؛ اضغط 🗑️ مسح لو مفيش تحصيل فعلي.',
    },
    {
      keys: ['فاتورة', 'اعتماد', 'مراجعة', 'مسودة'],
      answer:
        'الفاتورة بتتفتح من حركة المريض اليومية. احفظ مسودة، وبعدين أرسل للمراجعة، والمراجع يعتمدها. بعد الاعتماد مفيش تعديل — بس طباعة وPDF.',
    },
    {
      keys: ['حركة', 'يومية', 'ادوية', 'مستلزمات', 'اقامة'],
      answer:
        'من الرئيسية → حركة المريض. اختار المريض وسجّل البنود يوم بيوم (أدوية، مستلزمات، إقامة...). البنود بتتزامن تلقائي مع الفاتورة الكبيرة.',
    },
    {
      keys: ['مش متوازن', 'متبقي', 'نقص', 'زيادة'],
      answer:
        'لازم مجموع طرق الدفع = إجمالي الفاتورة. شوف تفصيل المدفوع تحت جدول الدفع. لو في خصم رصيد بس، ده مش نقدي — ممكن يبان إن الفاتورة متوازنة من غير كاش.',
    },
    {
      keys: ['طباعة', 'معاينة', 'pdf'],
      answer:
        'في الفاتورة الكبيرة اضغط «معاينة طباعة» عشان تشوف شكل الفاتورة. PDF وWord بيظهروا بعد الاعتماد النهائي.',
    },
    {
      keys: ['تنبيه', 'جرس', 'سجل', 'audit'],
      answer:
        'الجرس 🔔 للمسؤول بيعرض تنبيهات النظام (فاتورة غير متوازنة، رصيد سالب...). سجل التدقيق في الإعدادات → مراقبة النظام بيسجّل كل الإجراءات المهمة.',
    },
  ];

  const DEFAULT_ANSWER =
    'اسألني عن: التحصيل، الفاتورة، الحركة اليومية، المدفوعات، الطباعة، أو التنبيهات. مثال: «التحصيل جاي منين؟»';

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[؟?،,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findAnswer(question) {
    const q = normalize(question);
    if (!q) return DEFAULT_ANSWER;
    for (const item of FAQ) {
      if (item.keys.some((key) => q.includes(normalize(key)))) return item.answer;
    }
    if (q.includes('ازاي') || q.includes('إزاي')) {
      return 'قولّي عايز تعمل إيه بالظبط: فاتورة؟ حركة يومية؟ دفع؟ طباعة؟ وأنا أرشدك خطوة بخطوة.';
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
        appendMessage(messages, 'أهلاً! أنا مساعدك في النظام. اسألني بعاميتك — زي: التحصيل جاي منين؟', 'bot');
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
