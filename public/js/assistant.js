/**
 * مساعد إرشادي — إجابات مختصرة عن خطوات العمل.
 */
(function () {
  const FAQ = [
    {
      keys: ['سجل مريض', 'تسجيل مريض', 'مريض جديد', 'افتح ملف', 'ملف جديد'],
      answer:
        'من الشاشة الرئيسية اختر «تسجيل مريض جديد»، ثم حدّد نوع المريض (داخلي أو خارجي) وأدخل البيانات الأساسية. بعد الحفظ يُفتح ملف المريض وتُنشأ فاتورة مسودة تلقائيًا، وتنتقل إلى شاشة حركة المريض.',
    },
    {
      keys: ['تحصيل', 'محصل', 'فلوس', 'دفع نقد', 'خصم من رصيد', 'رصيد مريض'],
      answer:
        'يُسجَّل التحصيل نقدًا أو بتحويل بنكي أو بشيك، أو «خصمًا من رصيد المريض». الخصم من الرصيد ليس تحصيلًا نقديًا جديدًا، وإنما يُخصم من الرصيد المسجّل للمريض. تُسجَّل المدفوعات من شاشة الفاتورة الكبيرة.',
    },
    {
      keys: ['فاتورة كبيرة', 'مراجعة فاتورة', 'اعتماد', 'مسودة', 'ارسل للمراجعة'],
      answer:
        'تُفتح الفاتورة الكبيرة من شاشة حركة المريض. احفظها حفظًا مؤقتًا، ثم أرسلها للمراجعة ليعتمدها المراجع المالي. بعد الاعتماد يمكن طباعتها أو تنزيلها PDF، ولتعديلها تُعاد فتحها من زر «إعادة فتح الفاتورة للتعديل».',
    },
    {
      keys: ['حركة يومية', 'ادوية', 'مستلزمات', 'اقامة', 'حركة المريض'],
      answer:
        'من الشاشة الرئيسية اختر «حركة المريض»، ثم اختر المريض وسجّل البنود يومًا بيوم (أدوية، مستلزمات، إقامة...). تنتقل البنود تلقائيًا إلى الفاتورة الكبيرة.',
    },
    {
      keys: ['رصيد بعد', 'رصيد الحساب', '100', 'متبقي الدفع'],
      answer:
        '«رصيد الحساب» هو الرصيد الحالي للمريض، و«إجمالي الفاتورة» هو المبلغ المستحق، و«رصيد بعد الفاتورة» يساوي الرصيد مطروحًا منه إجمالي الفاتورة، و«متبقي الدفع» هو المبلغ الذي لم يُسدَّد بعد على الفاتورة.',
    },
    {
      keys: ['مش متوازن', 'نقص دفع', 'زيادة دفع', 'متبقي الدفع'],
      answer:
        'يجب أن يساوي مجموع طرق الدفع إجمالي الفاتورة. راجع تفصيل المدفوعات أسفل جدول الدفع. الخصم من رصيد المريض لا يُعد تحصيلًا نقديًا.',
    },
    {
      keys: ['طباعة', 'معاينة', 'pdf'],
      answer:
        'لمعاينة الفاتورة اضغط «طباعة كشف حساب فاتورة». يتاح تنزيل PDF وWord بعد الاعتماد النهائي، ويفتح مسح رمز QR المطبوع الفاتورة بصيغة PDF.',
    },
    {
      keys: ['تنبيه', 'جرس', 'audit', 'تدقيق', 'مراقبة النظام'],
      answer:
        'يعرض الجرس 🔔 تنبيهات النظام لمدير النظام. ويُسجِّل سجل التدقيق (الإعدادات ← مراقبة النظام) جميع الإجراءات المهمة.',
    },
  ];

  const DEFAULT_ANSWER =
    'يمكنك السؤال عن: تسجيل مريض، الحركة اليومية، الفاتورة، التحصيل، الرصيد، أو الطباعة.';

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
      return 'حدّد الإجراء المطلوب: تسجيل مريض، أو حركة يومية، أو فاتورة، أو دفع، أو طباعة.';
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
        appendMessage(messages, 'مرحبًا بك. يمكنك السؤال عن أي خطوة من خطوات العمل في النظام.', 'bot');
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

  let assistantBound = false;
  window.initAssistant = function initAssistant() {
    if (assistantBound) return;
    assistantBound = true;
    bindAssistant();
  };
})();
