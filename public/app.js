(function () {
  const STORAGE_KEYS = {
    sessionToken: "study-home.session-token",
    currentUser: "study-home.current-user-cache"
  };

  const LEGACY_STORAGE_KEYS = ["wind-butterfly.users", "wind-butterfly.current-user"];
  const PASSWORD_RULE_TEXT = "密码需要 8-16 位，只能使用字母和数字，并且必须同时包含两者。";
  const WORKSPACE_REFRESH_MS = 6000;
  const GENDER_OPTIONS = ["男", "女", "不方便透露"];
  const BLOG_VISIBILITY_OPTIONS = [
    { value: "public", label: "全部可见" },
    { value: "private", label: "仅自己可见" }
  ];
  const CHECKIN_VISIBILITY_OPTIONS = [
    { value: "private", label: "仅自己可见" },
    { value: "friends", label: "好友可见" }
  ];
  const MODULES = [
    { key: "blog", label: "博客" },
    { key: "checkin", label: "打卡" },
    { key: "timer", label: "番茄钟" },
    { key: "chat", label: "聊天" }
  ];
  const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
  const MAX_AVATAR_OUTPUT_BYTES = 1600 * 1024;
  const MAX_AVATAR_DIMENSION = 1600;
  const MAX_BLOG_OUTPUT_BYTES = 4 * 1024 * 1024;
  const MAX_BLOG_DIMENSION = 2400;

  const app = document.getElementById("app");
  let timerIntervalId = null;
  let workspaceRefreshIntervalId = null;

  cleanupLegacyStorage();

  const state = {
    loading: true,
    workspaceLoading: false,
    users: [],
    currentUser: readCachedUser(),
    sessionToken: localStorage.getItem(STORAGE_KEYS.sessionToken) || "",
    selectedUserId: "",
    authMode: "login",
    module: "blog",
    regionData: {
      countries: [],
      china: []
    },
    toast: null,
    notifications: [],
    friendRequests: [],
    friends: [],
    conversations: [],
    activeChatUserId: "",
    chatMessages: [],
    chatLoading: false,
    chatSubmitting: false,
    chatDraft: {
      content: ""
    },
    blogs: {
      mine: [],
      community: []
    },
    checkins: {
      mine: [],
      community: []
    },
    blogScope: "community",
    loginDraft: {
      password: ""
    },
    registerDraft: {
      name: "",
      password: "",
      confirmPassword: "",
      securityQuestion: "",
      securityAnswer: "",
      avatar: ""
    },
    blogDraft: {
      title: "",
      content: "",
      visibility: "public",
      imageUrls: []
    },
    checkinDraft: {
      title: "",
      frequency: "每天",
      visibility: "private"
    },
    profileDraft: createProfileDraft(readCachedUser()),
    profileSaving: false,
    profileAvatarProcessing: false,
    registerValidation: {
      password: {
        touched: false,
        status: "",
        message: ""
      },
      confirm: {
        touched: false,
        status: "",
        message: ""
      }
    },
    passwordVisibility: {
      login: false,
      register: false,
      registerConfirm: false,
      modalDelete: false,
      modalRecovery: false,
      modalRecoveryConfirm: false
    },
    timer: createDefaultTimerState(),
    avatarProcessing: false,
    blogImageUploading: false,
    expandedBlogIds: {},
    modal: null
  };

  bindEvents();
  render();
  initialize();

  // ---------------------------------------------------------------------------
  // Bootstrapping
  // ---------------------------------------------------------------------------

  async function initialize() {
    try {
      await Promise.all([loadRegionData(), refreshUsers()]);

      if (state.sessionToken) {
        try {
          const data = await apiRequest("/api/session", { auth: true });
          setSession(state.sessionToken, data.user);
          await refreshWorkspaceData();
          ensureWorkspaceRefreshLoop();
        } catch (error) {
          clearSession();
          if (error.status && error.status !== 401) {
            flash(error.message || "无法恢复当前登录状态。", "error", { title: "初始化失败" });
          }
        }
      }
    } catch (error) {
      flash(error.message || "无法连接服务器，请稍后再试。", "error", { title: "初始化失败" });
    } finally {
      if (!state.users.length) {
        state.authMode = "register";
      } else if (!state.currentUser) {
        state.authMode = "login";
      }
      state.loading = false;
      render();
    }
  }

  async function loadRegionData() {
    const [countries, china] = await Promise.all([
      apiRequest("/data/countries.json"),
      apiRequest("/data/china-level.json")
    ]);

    state.regionData.countries = normalizeCountries(countries);
    state.regionData.china = normalizeChinaRegions(china);
  }

  async function refreshUsers() {
    const data = await apiRequest("/api/users");
    state.users = Array.isArray(data.users) ? data.users : [];

    if (!state.users.length) {
      state.selectedUserId = "";
      state.authMode = "register";
      return;
    }

    if (state.currentUser && state.users.some((user) => user.id === state.currentUser.id)) {
      state.selectedUserId = state.currentUser.id;
      return;
    }

    if (!state.selectedUserId || !state.users.some((user) => user.id === state.selectedUserId)) {
      state.selectedUserId = state.users[0].id;
    }
  }

  async function refreshWorkspaceData() {
    if (!state.currentUser || !state.sessionToken) {
      state.blogs.mine = [];
      state.blogs.community = [];
      state.checkins.mine = [];
      state.checkins.community = [];
      state.notifications = [];
      state.friendRequests = [];
      state.friends = [];
      state.conversations = [];
      state.chatMessages = [];
      state.activeChatUserId = "";
      return;
    }

    state.workspaceLoading = true;
    render();

    try {
      const previousUnreadCount = getUnreadNotificationsCount();
      const data = await apiRequest("/api/dashboard", { auth: true });
      state.blogs.mine = Array.isArray(data.blogs && data.blogs.mine) ? data.blogs.mine : [];
      state.blogs.community = Array.isArray(data.blogs && data.blogs.community) ? data.blogs.community : [];
      state.checkins.mine = Array.isArray(data.checkins && data.checkins.mine) ? data.checkins.mine : [];
      state.checkins.community = Array.isArray(data.checkins && data.checkins.community) ? data.checkins.community : [];
      state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
      state.friendRequests = Array.isArray(data.friendRequests) ? data.friendRequests : [];
      state.friends = Array.isArray(data.friends) ? data.friends : [];
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];

      if (
        state.activeChatUserId &&
        !state.friends.some((friend) => friend.id === state.activeChatUserId) &&
        !state.conversations.some((item) => item.user && item.user.id === state.activeChatUserId)
      ) {
        state.activeChatUserId = "";
        state.chatMessages = [];
      }

      const nextUnreadCount = getUnreadNotificationsCount();
      if (nextUnreadCount > previousUnreadCount) {
        state.toast = {
          type: "info",
          text: "你收到了新的互动提醒。"
        };
      }

      if (state.module === "chat" && state.activeChatUserId) {
        await refreshActiveChat(true);
      }
    } finally {
      state.workspaceLoading = false;
      render();
    }
  }

  function ensureWorkspaceRefreshLoop() {
    stopWorkspaceRefreshLoop();

    if (!state.currentUser || !state.sessionToken) {
      return;
    }

    workspaceRefreshIntervalId = window.setInterval(async function () {
      if (!state.currentUser || !state.sessionToken) {
        stopWorkspaceRefreshLoop();
        return;
      }

      try {
        await refreshWorkspaceData();
      } catch (error) {
        // Keep the loop alive; the next round can recover.
      }
    }, WORKSPACE_REFRESH_MS);
  }

  function stopWorkspaceRefreshLoop() {
    if (workspaceRefreshIntervalId) {
      clearInterval(workspaceRefreshIntervalId);
      workspaceRefreshIntervalId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  function bindEvents() {
    app.addEventListener("click", handleClick);
    app.addEventListener("submit", handleSubmit);
    app.addEventListener("input", handleInput);
    app.addEventListener("change", handleChange);
    app.addEventListener("keydown", handleKeyDown);
    app.addEventListener("focusout", handleFocusOut);
  }

  async function handleClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (state.modal && event.target.classList.contains("modal-backdrop")) {
      closeModal();
      return;
    }

    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.dataset.action;

    if (action === "switchMode") {
      state.authMode = actionTarget.dataset.mode === "login" ? "login" : "register";
      state.modal = null;
      clearToast();
      resetPasswordVisibility();
      render();
      return;
    }

    if (action === "selectUser") {
      state.selectedUserId = actionTarget.dataset.userId || "";
      state.authMode = "login";
      state.loginDraft.password = "";
      clearToast();
      resetPasswordVisibility();
      render();
      return;
    }

    if (action === "togglePassword") {
      const field = actionTarget.dataset.field || "";
      if (Object.prototype.hasOwnProperty.call(state.passwordVisibility, field)) {
        state.passwordVisibility[field] = !state.passwordVisibility[field];
        render();
      }
      return;
    }

    if (action === "switchModule") {
      const nextModule = actionTarget.dataset.module || "blog";
      if (nextModule === "profile") {
        state.module = "profile";
      } else {
        state.module = MODULES.some((item) => item.key === nextModule) ? nextModule : "blog";
      }

      if (nextModule === "blog") {
        state.blogScope = "community";
      }

      if (nextModule === "chat") {
        await openChatWithUser(
          actionTarget.dataset.userId ||
            state.activeChatUserId ||
            ((state.conversations[0] && state.conversations[0].user && state.conversations[0].user.id) || "")
        );
        return;
      }

      render();
      return;
    }

    if (action === "openProfile") {
      state.module = "profile";
      state.modal = null;
      render();
      return;
    }

    if (action === "switchBlogScope") {
      state.blogScope = actionTarget.dataset.scope === "mine" ? "mine" : "community";
      render();
      return;
    }

    if (action === "openBlogDetail") {
      await openBlogDetail(actionTarget.dataset.blogId || "");
      return;
    }

    if (action === "openPublishBlog") {
      state.modal = {
        kind: "publishBlog"
      };
      render();
      return;
    }

    if (action === "toggleBlogExpand") {
      const blogId = actionTarget.dataset.blogId || "";
      if (!blogId) {
        return;
      }

      state.expandedBlogIds[blogId] = !state.expandedBlogIds[blogId];
      render();
      return;
    }

    if (action === "requestDeleteBlog") {
      const blogId = actionTarget.dataset.blogId || "";
      if (!blogId) {
        return;
      }

      state.modal = {
        kind: "confirm",
        action: "deleteBlog",
        blogId,
        title: "删除这篇博客？",
        text: "删除后，这篇博客的正文、评论和已上传图片都会一起从服务器移除。",
        confirmLabel: "删除博客"
      };
      render();
      return;
    }

    if (action === "openUserSpace") {
      await openUserSpace(actionTarget.dataset.userId || "");
      return;
    }

    if (action === "sendFriendRequest") {
      await sendFriendRequest(actionTarget.dataset.userId || "");
      return;
    }

    if (action === "acceptFriendRequest") {
      await respondFriendRequest(actionTarget.dataset.requestId || "", "accepted");
      return;
    }

    if (action === "rejectFriendRequest") {
      await respondFriendRequest(actionTarget.dataset.requestId || "", "rejected");
      return;
    }

    if (action === "openChat") {
      await openChatWithUser(actionTarget.dataset.userId || "");
      return;
    }

    if (action === "selectChatUser") {
      await openChatWithUser(actionTarget.dataset.userId || "");
      return;
    }

    if (action === "submitChatMessage") {
      await submitChatMessage();
      return;
    }

    if (action === "removeBlogImage") {
      const url = actionTarget.dataset.url || "";
      state.blogDraft.imageUrls = state.blogDraft.imageUrls.filter((item) => item !== url);
      state.blogDraft.content = state.blogDraft.content.replace(
        new RegExp("!\\[[^\\]]*\\]\\(" + escapeRegExp(url) + "\\)\\n?", "g"),
        ""
      );
      render();
      return;
    }

    if (action === "requestSwitchUser") {
      state.modal = {
        kind: "confirm",
        action: "switchUser",
        title: "切换用户？",
        text: "这会退出当前用户，并回到登录界面让你重新选择账户。",
        confirmLabel: "继续切换"
      };
      render();
      return;
    }

    if (action === "requestLogout") {
      state.modal = {
        kind: "confirm",
        action: "logout",
        title: "退出登录？",
        text: "这会退出当前账户，但不会删除服务器里保存的用户信息。",
        confirmLabel: "退出登录"
      };
      render();
      return;
    }

    if (action === "requestDeleteUser") {
      const currentUser = state.currentUser;
      state.modal = {
        kind: "deleteUser",
        title: "删除当前用户？",
        text: currentUser
          ? "请输入 " + currentUser.name + " 的密码后再删除。删除后，这个用户在服务器中的博客、打卡和提醒也会一起移除。"
          : "请输入当前账户密码后再删除。",
        confirmLabel: "确认删除",
        password: "",
        error: ""
      };
      state.passwordVisibility.modalDelete = false;
      render();
      return;
    }

    if (action === "openRecovery") {
      await openRecoveryModal();
      return;
    }

    if (action === "dismissModal") {
      closeModal();
      return;
    }

    if (action === "confirmModal") {
      await confirmModalAction();
      return;
    }

    if (action === "dismissToast") {
      clearToast();
      render();
      return;
    }

    if (action === "portalPlaceholder") {
      flash("这个入口已经留好，下一部分继续接。", "success");
      render();
      return;
    }

    if (action === "completeCheckin") {
      await completeCheckin(actionTarget.dataset.itemId || "");
      return;
    }

    if (action === "openCheckinHistory") {
      const item = findStateCheckinItem(actionTarget.dataset.itemId || "");
      if (!item) {
        return;
      }

      state.modal = {
        kind: "checkinHistory",
        itemId: item.id
      };
      render();
      return;
    }

    if (action === "openReminderModal") {
      const item = findStateCheckinItem(actionTarget.dataset.itemId || "");
      if (!item) {
        return;
      }

      state.modal = {
        kind: "checkinReminder",
        itemId: item.id,
        message: "",
        error: ""
      };
      render();
      return;
    }

    if (action === "markNotificationRead") {
      await markNotificationRead(actionTarget.dataset.notificationId || "");
      return;
    }

    if (action === "openNotificationBlog") {
      await openBlogDetail(actionTarget.dataset.blogId || "");
      return;
    }

    if (action === "markAllNotificationsRead") {
      await markNotificationRead("");
      return;
    }

    if (action === "toggleBlogLike") {
      await toggleBlogLike(actionTarget.dataset.blogId || "");
      return;
    }

    if (action === "submitBlogComment") {
      await submitBlogComment();
      return;
    }

    if (action === "startTimer") {
      startTimer();
      return;
    }

    if (action === "pauseTimer") {
      pauseTimer();
      return;
    }

    if (action === "resetTimer") {
      resetTimer(state.timer.mode);
      render();
      return;
    }

    if (action === "switchTimerMode") {
      const nextMode = actionTarget.dataset.mode === "break" ? "break" : "focus";
      switchTimerMode(nextMode);
      render();
      return;
    }

    if (action === "applyTimerPreset") {
      applyTimerPreset(
        Number(actionTarget.dataset.focus || 25),
        Number(actionTarget.dataset.break || 5)
      );
      render();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.dataset.form === "login") {
      await submitLogin();
      return;
    }

    if (form.dataset.form === "register") {
      await submitRegister();
      return;
    }

    if (form.dataset.form === "profile") {
      await submitProfile();
      return;
    }

    if (form.dataset.form === "blog") {
      await submitBlog();
      return;
    }

    if (form.dataset.form === "checkin") {
      await submitCheckin();
      return;
    }

    if (form.dataset.form === "chat") {
      await submitChatMessage();
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }

    if (target.name === "loginPassword") {
      state.loginDraft.password = target.value;
      return;
    }

    if (target.name === "registerName") {
      state.registerDraft.name = target.value;
      return;
    }

    if (target.name === "registerPassword") {
      state.registerDraft.password = target.value;
      return;
    }

    if (target.name === "registerConfirmPassword") {
      state.registerDraft.confirmPassword = target.value;
      return;
    }

    if (target.name === "registerSecurityQuestion") {
      state.registerDraft.securityQuestion = target.value;
      return;
    }

    if (target.name === "registerSecurityAnswer") {
      state.registerDraft.securityAnswer = target.value;
      return;
    }

    if (target.name === "profileBio") {
      state.profileDraft.bio = target.value;
      return;
    }

    if (target.name === "blogTitle") {
      state.blogDraft.title = target.value;
      syncBlogPreview();
      return;
    }

    if (target.name === "blogContent") {
      state.blogDraft.content = target.value;
      syncBlogPreview();
      return;
    }

    if (target.name === "checkinTitle") {
      state.checkinDraft.title = target.value;
      return;
    }

    if (target.name === "checkinFrequency") {
      state.checkinDraft.frequency = target.value;
      return;
    }

    if (target.name === "chatMessage") {
      state.chatDraft.content = target.value;
      return;
    }

    if (target.name === "modalPassword" && state.modal && state.modal.kind === "deleteUser") {
      state.modal.password = target.value;
      return;
    }

    if (target.name === "reminderMessage" && state.modal && state.modal.kind === "checkinReminder") {
      state.modal.message = target.value;
      return;
    }

    if (target.name === "blogCommentContent" && state.modal && state.modal.kind === "blogDetail") {
      state.modal.commentContent = target.value;
      return;
    }

    if (state.modal && state.modal.kind === "recovery") {
      if (target.name === "recoveryAnswer") {
        state.modal.answer = target.value;
        return;
      }

      if (target.name === "recoveryNewPassword") {
        state.modal.newPassword = target.value;
        return;
      }

      if (target.name === "recoveryConfirmPassword") {
        state.modal.confirmPassword = target.value;
      }
    }
  }

  async function handleChange(event) {
    const target = event.target;

    if (target instanceof HTMLSelectElement) {
      if (target.name === "profileGender") {
        state.profileDraft.gender = target.value;
        render();
        return;
      }

      if (target.name === "profileCountry") {
        updateProfileCountry(target.value);
        render();
        return;
      }

      if (target.name === "profileProvince") {
        updateProfileProvince(target.value);
        render();
        return;
      }

      if (target.name === "profileCity") {
        updateProfileCity(target.value);
        render();
        return;
      }

      if (target.name === "profileCounty") {
        updateProfileCounty(target.value);
        render();
        return;
      }

      if (target.name === "blogVisibility") {
        state.blogDraft.visibility = target.value === "private" ? "private" : "public";
        render();
        return;
      }

      if (target.name === "checkinVisibility") {
        state.checkinDraft.visibility = target.value === "friends" ? "friends" : "private";
        render();
      }
      return;
    }

    if (target instanceof HTMLInputElement && target.type === "number") {
      if (target.name === "timerFocusMinutes") {
        state.timer.focusMinutes = clampMinutes(target.value, 25);
        if (!state.timer.isRunning && state.timer.mode === "focus") {
          state.timer.remainingSeconds = state.timer.focusMinutes * 60;
        }
        render();
        return;
      }

      if (target.name === "timerBreakMinutes") {
        state.timer.breakMinutes = clampMinutes(target.value, 5);
        if (!state.timer.isRunning && state.timer.mode === "break") {
          state.timer.remainingSeconds = state.timer.breakMinutes * 60;
        }
        render();
        return;
      }
    }

    if (
      !(target instanceof HTMLInputElement) ||
      !["registerAvatar", "profileAvatar", "blogImageUpload"].includes(target.name)
    ) {
      return;
    }

    const file = target.files && target.files[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      flash(target.name === "blogImageUpload" ? "请选择图片文件。" : "头像需要选择图片文件。", "error", {
        title: target.name === "blogImageUpload" ? "图片上传失败" : "头像上传失败"
      });
      target.value = "";
      render();
      return;
    }

    if (file.size > MAX_IMAGE_INPUT_BYTES) {
      flash("图片原图请控制在 12MB 以内。", "error", {
        title: target.name === "blogImageUpload" ? "图片上传失败" : "头像上传失败"
      });
      target.value = "";
      render();
      return;
    }

    const isProfileAvatar = target.name === "profileAvatar";
    const isRegisterAvatar = target.name === "registerAvatar";
    const isBlogImage = target.name === "blogImageUpload";

    if (isProfileAvatar) {
      state.profileAvatarProcessing = true;
      flash("正在处理新头像，会自动压缩分辨率和体积。", "info");
    } else if (isRegisterAvatar) {
      state.avatarProcessing = true;
      flash("正在处理头像，会自动压缩分辨率和体积。", "info");
    } else {
      state.blogImageUploading = true;
      flash("正在处理博客图片，会自动压缩分辨率和体积。", "info");
    }
    render();

    try {
      const optimizedAvatar = await optimizeAvatar(
        file,
        isBlogImage
          ? {
              maxDimension: MAX_BLOG_DIMENSION,
              maxOutputBytes: MAX_BLOG_OUTPUT_BYTES,
              background: "#fffaf6"
            }
          : undefined
      );
      const uploaded = await uploadImageData(optimizedAvatar, isBlogImage ? "blog" : "avatar");

      if (isProfileAvatar) {
        state.profileDraft.avatar = uploaded.url;
        flash("新头像已处理完成，记得点击保存资料。", "success");
      } else if (isRegisterAvatar) {
        state.registerDraft.avatar = uploaded.url;
        flash("头像已处理完成，可以继续注册。", "success");
      } else {
        if (!state.blogDraft.imageUrls.includes(uploaded.url)) {
          state.blogDraft.imageUrls.push(uploaded.url);
        }
        appendImageMarkdown(uploaded.url);
        flash("图片已上传，并且已经插入到 Markdown 编辑区。", "success");
      }
    } catch (error) {
      if (isProfileAvatar) {
        state.profileDraft.avatar = getSafeAvatar(state.currentUser && state.currentUser.avatar);
      } else if (isRegisterAvatar) {
        state.registerDraft.avatar = "";
      }
      flash(error && error.message ? error.message : "图片处理失败，请换一张图片再试。", "error", {
        title: isBlogImage ? "图片上传失败" : "头像上传失败"
      });
    } finally {
      if (isProfileAvatar) {
        state.profileAvatarProcessing = false;
      } else if (isRegisterAvatar) {
        state.avatarProcessing = false;
      } else {
        state.blogImageUploading = false;
      }
      target.value = "";
      render();
    }
  }

  function handleFocusOut(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.name === "registerPassword") {
      validateRegisterPassword(true);
      if (state.registerValidation.confirm.touched) {
        validateRegisterConfirm(false);
      }
      render();
      return;
    }

    if (target.name === "registerConfirmPassword") {
      validateRegisterConfirm(true);
      render();
    }
  }

  function handleKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (state.modal) {
      closeModal();
      return;
    }

    if (state.toast) {
      clearToast();
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication and account actions
  // ---------------------------------------------------------------------------

  async function submitLogin() {
    const selectedUser = state.users.find((user) => user.id === state.selectedUserId);

    if (!selectedUser) {
      flash("先选择一个已有用户。", "error", { title: "登录失败" });
      render();
      return;
    }

    if (!state.loginDraft.password) {
      flash("请输入密码。", "error", { title: "登录失败" });
      render();
      return;
    }

    try {
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: {
          userId: selectedUser.id,
          password: state.loginDraft.password
        }
      });

      setSession(data.token, data.user);
      state.loginDraft.password = "";
      resetPasswordVisibility();
      await refreshWorkspaceData();
      flash("欢迎回来，当前设备会记住你。", "success");
    } catch (error) {
      flash(error.message || "登录失败，请稍后再试。", "error", { title: "登录失败" });
    } finally {
      render();
    }
  }

  async function submitRegister() {
    const name = state.registerDraft.name.trim();
    const securityQuestion = state.registerDraft.securityQuestion.trim();
    const securityAnswer = state.registerDraft.securityAnswer.trim();
    const passwordValid = validateRegisterPassword(true);
    const confirmValid = validateRegisterConfirm(true);

    if (!name) {
      flash("用户名不能为空。", "error", { title: "注册失败" });
      render();
      return;
    }

    if (name.length > 18) {
      flash("用户名控制在 18 个字以内，更适合首页展示。", "error", { title: "注册失败" });
      render();
      return;
    }

    if (!passwordValid || !confirmValid) {
      render();
      return;
    }

    if (!securityQuestion) {
      flash("请设置一个密保问题。", "error", { title: "注册失败" });
      render();
      return;
    }

    if (!securityAnswer) {
      flash("请填写密保答案。", "error", { title: "注册失败" });
      render();
      return;
    }

    if (state.avatarProcessing) {
      flash("头像还在处理中，请稍等一下。", "info");
      render();
      return;
    }

    if (!state.registerDraft.avatar) {
      flash("请先上传头像。", "error", { title: "注册失败" });
      render();
      return;
    }

    try {
      const data = await apiRequest("/api/register", {
        method: "POST",
        body: {
          name,
          password: state.registerDraft.password,
          confirmPassword: state.registerDraft.confirmPassword,
          securityQuestion,
          securityAnswer,
          avatar: state.registerDraft.avatar
        }
      });

      state.registerDraft = {
        name: "",
        password: "",
        confirmPassword: "",
        securityQuestion: "",
        securityAnswer: "",
        avatar: ""
      };
      resetRegisterValidation();
      setSession(data.token, data.user);
      await refreshWorkspaceData();
      flash("账号已注册完成，并且已经同步保存到服务器。", "success");
    } catch (error) {
      flash(error.message || "注册失败，请稍后再试。", "error", { title: "注册失败" });
    } finally {
      render();
    }
  }

  async function submitProfile() {
    if (!state.currentUser) {
      return;
    }

    if (state.profileAvatarProcessing) {
      flash("头像还在处理中，等处理完成后再保存资料。", "info");
      render();
      return;
    }

    if (!["", ...GENDER_OPTIONS].includes(state.profileDraft.gender)) {
      flash("请从给定选项中选择性别。", "error", { title: "资料保存失败" });
      render();
      return;
    }

    if (state.profileDraft.bio.trim().length > 240) {
      flash("个人介绍请控制在 240 个字以内。", "error", { title: "资料保存失败" });
      render();
      return;
    }

    if (
      state.profileDraft.location.countryCode === "CN" &&
      state.profileDraft.location.countryName &&
      (!state.profileDraft.location.provinceCode ||
        !state.profileDraft.location.cityCode ||
        !state.profileDraft.location.countyCode)
    ) {
      flash("选择中国地区时，请依次选到省、市、县。", "error", { title: "资料保存失败" });
      render();
      return;
    }

    state.profileSaving = true;
    render();

    try {
      const data = await apiRequest("/api/profile", {
        method: "POST",
        auth: true,
        body: {
          avatar: state.profileDraft.avatar,
          gender: state.profileDraft.gender,
          bio: state.profileDraft.bio.trim(),
          location: state.profileDraft.location
        }
      });

      setSession(state.sessionToken, data.user);
      flash("个人资料已保存到服务器。", "success");
    } catch (error) {
      flash(error.message || "资料保存失败，请稍后再试。", "error", { title: "资料保存失败" });
    } finally {
      state.profileSaving = false;
      render();
    }
  }

  async function openRecoveryModal() {
    const selectedUser = state.users.find((user) => user.id === state.selectedUserId);
    if (!selectedUser) {
      flash("先选择一个用户，再使用找回密码。", "error", { title: "找回密码失败" });
      render();
      return;
    }

    state.modal = {
      kind: "recovery",
      title: "找回密码",
      userId: selectedUser.id,
      userName: selectedUser.name,
      question: "",
      loading: true,
      answer: "",
      newPassword: "",
      confirmPassword: "",
      error: ""
    };
    resetPasswordVisibility();
    render();

    try {
      const data = await apiRequest("/api/recovery/question?userId=" + encodeURIComponent(selectedUser.id));
      if (state.modal && state.modal.kind === "recovery" && state.modal.userId === selectedUser.id) {
        state.modal.question = data.question;
        state.modal.loading = false;
        render();
      }
    } catch (error) {
      state.modal = null;
      flash(error.message || "无法加载密保问题。", "error", { title: "找回密码失败" });
      render();
    }
  }

  async function confirmModalAction() {
    if (!state.modal) {
      return;
    }

    if (state.modal.kind === "alert") {
      closeModal();
      return;
    }

    if (state.modal.kind === "confirm" && state.modal.action === "switchUser") {
      await logoutCurrentUser("已退出当前账户，请重新选择要登录的用户。", true);
      return;
    }

    if (state.modal.kind === "confirm" && state.modal.action === "logout") {
      await logoutCurrentUser("已退出登录。", false);
      return;
    }

    if (state.modal.kind === "confirm" && state.modal.action === "deleteBlog") {
      await deleteBlog(state.modal.blogId || "");
      return;
    }

    if (state.modal.kind === "deleteUser") {
      await deleteCurrentUser();
      return;
    }

    if (state.modal.kind === "recovery") {
      await submitRecovery();
      return;
    }

    if (state.modal.kind === "checkinReminder") {
      await submitCheckinReminder();
    }
  }

  async function logoutCurrentUser(message, pickNextUser) {
    const currentUserId = state.currentUser ? state.currentUser.id : state.selectedUserId;

    try {
      if (state.sessionToken) {
        await apiRequest("/api/logout", {
          method: "POST",
          auth: true
        });
      }
    } catch (error) {
      // Ignore server logout errors and clear the local session anyway.
    }

    pauseTimer();
    stopWorkspaceRefreshLoop();
    clearSession();
    state.loginDraft.password = "";
    state.modal = null;

    if (pickNextUser) {
      const nextUser = state.users.find((user) => user.id !== currentUserId) || null;
      state.selectedUserId = nextUser ? nextUser.id : currentUserId;
    } else {
      state.selectedUserId = currentUserId;
    }

    resetPasswordVisibility();
    flash(message, "info");
    render();
  }

  async function deleteCurrentUser() {
    if (!state.modal || state.modal.kind !== "deleteUser") {
      return;
    }

    if (!state.modal.password) {
      state.modal.error = "请输入当前账户密码后再删除。";
      render();
      return;
    }

    try {
      await apiRequest("/api/users/delete", {
        method: "POST",
        auth: true,
        body: {
          password: state.modal.password
        }
      });

      const removedUserId = state.currentUser ? state.currentUser.id : "";
      pauseTimer();
      clearSession();
      state.loginDraft.password = "";
      state.modal = null;
      resetPasswordVisibility();
      await refreshUsers();

      if (state.users.length) {
        state.authMode = "login";
        state.selectedUserId = state.users[0].id;
        flash("当前用户已删除，服务器数据也已同步移除。", "success");
      } else {
        state.authMode = "register";
        state.selectedUserId = "";
        flash("当前用户已删除，服务器里已经没有账户了。", "success");
      }

      if (removedUserId && state.selectedUserId === removedUserId) {
        state.selectedUserId = state.users.length ? state.users[0].id : "";
      }
    } catch (error) {
      state.modal.error = error.message || "删除用户失败，请稍后再试。";
    } finally {
      render();
    }
  }

  async function submitRecovery() {
    if (!state.modal || state.modal.kind !== "recovery") {
      return;
    }

    if (state.modal.loading) {
      return;
    }

    if (!state.modal.answer.trim()) {
      state.modal.error = "请输入密保答案。";
      render();
      return;
    }

    if (!isValidPassword(state.modal.newPassword)) {
      state.modal.error = PASSWORD_RULE_TEXT;
      render();
      return;
    }

    if (state.modal.newPassword !== state.modal.confirmPassword) {
      state.modal.error = "两次输入的新密码不一致。";
      render();
      return;
    }

    try {
      await apiRequest("/api/recovery/reset", {
        method: "POST",
        body: {
          userId: state.modal.userId,
          securityAnswer: state.modal.answer,
          newPassword: state.modal.newPassword,
          confirmPassword: state.modal.confirmPassword
        }
      });

      state.modal = null;
      resetPasswordVisibility();
      flash("密码已重置，请使用新密码重新登录。", "success");
    } catch (error) {
      state.modal.error = error.message || "重置密码失败，请稍后再试。";
    } finally {
      render();
    }
  }

  function setSession(token, user) {
    state.sessionToken = token || "";
    state.currentUser = user || null;
    state.profileDraft = createProfileDraft(user);
    state.module = "blog";
    state.activeChatUserId = "";
    state.chatMessages = [];

    if (state.sessionToken) {
      localStorage.setItem(STORAGE_KEYS.sessionToken, state.sessionToken);
    } else {
      localStorage.removeItem(STORAGE_KEYS.sessionToken);
    }

    if (state.currentUser) {
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(state.currentUser));
      state.selectedUserId = state.currentUser.id;
    } else {
      localStorage.removeItem(STORAGE_KEYS.currentUser);
    }

    ensureWorkspaceRefreshLoop();
  }

  function clearSession() {
    stopWorkspaceRefreshLoop();
    state.sessionToken = "";
    state.currentUser = null;
    state.profileDraft = createProfileDraft(null);
    state.notifications = [];
    state.friendRequests = [];
    state.friends = [];
    state.conversations = [];
    state.blogs.mine = [];
    state.blogs.community = [];
    state.checkins.mine = [];
    state.checkins.community = [];
    state.activeChatUserId = "";
    state.chatMessages = [];
    state.module = "blog";
    localStorage.removeItem(STORAGE_KEYS.sessionToken);
    localStorage.removeItem(STORAGE_KEYS.currentUser);
  }

  // ---------------------------------------------------------------------------
  // Blog module
  // ---------------------------------------------------------------------------

  async function submitBlog() {
    const title = state.blogDraft.title.trim();
    const content = state.blogDraft.content.trim();

    if (state.blogImageUploading) {
      flash("图片还在处理中，请等上传完成后再发布。", "info");
      render();
      return;
    }

    if (!title) {
      flash("博客标题不能为空。", "error", { title: "发布失败" });
      render();
      return;
    }

    if (!content && !state.blogDraft.imageUrls.length) {
      flash("博客内容和图片至少需要填写一项。", "error", { title: "发布失败" });
      render();
      return;
    }

    try {
      await apiRequest("/api/blogs", {
        method: "POST",
        auth: true,
        body: {
          title,
          content,
          visibility: state.blogDraft.visibility,
          imageUrls: state.blogDraft.imageUrls
        }
      });

      state.blogDraft = {
        title: "",
        content: "",
        visibility: "public",
        imageUrls: []
      };
      state.modal = null;
      state.blogScope = "community";
      await refreshWorkspaceData();
      flash("博客已发布到服务器。", "success");
    } catch (error) {
      flash(error.message || "博客发布失败，请稍后再试。", "error", { title: "发布失败" });
      render();
    }
  }

  async function openBlogDetail(blogId, preserveCommentContent) {
    if (!blogId) {
      return;
    }

    const previousComment =
      preserveCommentContent && state.modal && state.modal.kind === "blogDetail" && state.modal.blogId === blogId
        ? state.modal.commentContent || ""
        : "";

    state.modal = {
      kind: "blogDetail",
      blogId,
      loading: true,
      blog: null,
      commentContent: previousComment,
      error: "",
      commentSubmitting: false
    };
    render();

    try {
      const data = await apiRequest("/api/blogs/detail?blogId=" + encodeURIComponent(blogId), {
        auth: true
      });

      if (state.modal && state.modal.kind === "blogDetail" && state.modal.blogId === blogId) {
        state.modal.loading = false;
        state.modal.blog = data.blog || null;
        state.modal.error = "";
        state.modal.commentSubmitting = false;
        render();
      }
    } catch (error) {
      state.modal = null;
      flash(error.message || "无法打开这篇博客。", "error", { title: "查看失败" });
      render();
    }
  }

  async function toggleBlogLike(blogId) {
    if (!blogId) {
      return;
    }

    try {
      const data = await apiRequest("/api/blogs/like", {
        method: "POST",
        auth: true,
        body: {
          blogId
        }
      });

      await refreshWorkspaceData();

      if (state.modal && state.modal.kind === "blogDetail" && state.modal.blogId === blogId) {
        state.modal.blog = data.blog || state.modal.blog;
        state.modal.error = "";
        render();
      }
    } catch (error) {
      if (state.modal && state.modal.kind === "blogDetail" && state.modal.blogId === blogId) {
        state.modal.error = error.message || "点赞操作失败，请稍后再试。";
        render();
        return;
      }

      flash(error.message || "点赞操作失败，请稍后再试。", "error", { title: "操作失败" });
      render();
    }
  }

  async function submitBlogComment() {
    if (!state.modal || state.modal.kind !== "blogDetail" || !state.modal.blog) {
      return;
    }

    const content = (state.modal.commentContent || "").trim();
    if (!content) {
      state.modal.error = "评论内容不能为空。";
      render();
      return;
    }

    state.modal.commentSubmitting = true;
    state.modal.error = "";
    render();

    try {
      const data = await apiRequest("/api/blogs/comments", {
        method: "POST",
        auth: true,
        body: {
          blogId: state.modal.blogId,
          content
        }
      });

      await refreshWorkspaceData();

      if (state.modal && state.modal.kind === "blogDetail" && state.modal.blogId === data.blog.id) {
        state.modal.blog = data.blog || state.modal.blog;
        state.modal.commentContent = "";
        state.modal.commentSubmitting = false;
        state.modal.error = "";
        render();
      }
    } catch (error) {
      if (state.modal && state.modal.kind === "blogDetail") {
        state.modal.commentSubmitting = false;
        state.modal.error = error.message || "评论发布失败，请稍后再试。";
        render();
        return;
      }

      flash(error.message || "评论发布失败，请稍后再试。", "error", { title: "评论失败" });
      render();
    }
  }

  async function deleteBlog(blogId) {
    if (!blogId) {
      return;
    }

    try {
      await apiRequest("/api/blogs/delete", {
        method: "POST",
        auth: true,
        body: {
          blogId
        }
      });

      state.modal = null;
      delete state.expandedBlogIds[blogId];
      await refreshWorkspaceData();
      flash("博客已经删除。", "success");
    } catch (error) {
      flash(error.message || "删除博客失败，请稍后再试。", "error", { title: "删除失败" });
      render();
    }
  }

  async function openUserSpace(userId) {
    if (!userId) {
      return;
    }

    state.modal = {
      kind: "userSpace",
      userId,
      loading: true,
      space: null,
      error: ""
    };
    render();

    try {
      const data = await apiRequest("/api/users/space?userId=" + encodeURIComponent(userId), {
        auth: true
      });

      if (state.modal && state.modal.kind === "userSpace" && state.modal.userId === userId) {
        state.modal.loading = false;
        state.modal.space = data || null;
        state.modal.error = "";
        render();
      }
    } catch (error) {
      state.modal = null;
      flash(error.message || "无法打开这个主页。", "error", { title: "查看失败" });
      render();
    }
  }

  async function sendFriendRequest(userId) {
    if (!userId) {
      return;
    }

    try {
      await apiRequest("/api/friends/request", {
        method: "POST",
        auth: true,
        body: {
          userId
        }
      });

      await refreshWorkspaceData();
      if (state.modal && state.modal.kind === "userSpace" && state.modal.userId === userId) {
        await openUserSpace(userId);
      }
      flash("好友申请已经发出。", "success");
    } catch (error) {
      flash(error.message || "好友申请发送失败。", "error", { title: "操作失败" });
      render();
    }
  }

  async function respondFriendRequest(requestId, decision) {
    if (!requestId) {
      return;
    }

    try {
      await apiRequest("/api/friends/respond", {
        method: "POST",
        auth: true,
        body: {
          requestId,
          decision
        }
      });

      await refreshWorkspaceData();
      if (state.modal && state.modal.kind === "userSpace" && state.modal.userId) {
        await openUserSpace(state.modal.userId);
      }
      flash(decision === "accepted" ? "已经成为好友，现在可以聊天和共享计划了。" : "已拒绝这条好友申请。", "success");
    } catch (error) {
      flash(error.message || "好友申请处理失败。", "error", { title: "操作失败" });
      render();
    }
  }

  async function openChatWithUser(userId) {
    const nextUserId =
      userId ||
      state.activeChatUserId ||
      ((state.conversations[0] && state.conversations[0].user && state.conversations[0].user.id) || "");

    state.module = "chat";
    state.modal = null;
    if (!nextUserId) {
      render();
      return;
    }

    if (state.activeChatUserId !== nextUserId) {
      state.chatDraft.content = "";
    }
    state.activeChatUserId = nextUserId;
    await refreshActiveChat();
  }

  async function refreshActiveChat(silent) {
    if (!state.activeChatUserId || !state.sessionToken) {
      state.chatMessages = [];
      if (!silent) {
        render();
      }
      return;
    }

    state.chatLoading = true;
    if (!silent) {
      render();
    }

    try {
      const data = await apiRequest("/api/chats/messages?userId=" + encodeURIComponent(state.activeChatUserId), {
        auth: true
      });

      state.chatMessages = Array.isArray(data.messages) ? data.messages : [];
      state.chatLoading = false;
      render();
    } catch (error) {
      state.chatLoading = false;
      flash(error.message || "聊天内容加载失败。", "error", { title: "聊天失败" });
      render();
    }
  }

  async function submitChatMessage() {
    if (!state.activeChatUserId) {
      flash("先选择一位好友，再发送消息。", "error", { title: "发送失败" });
      render();
      return;
    }

    const content = state.chatDraft.content.trim();
    if (!content) {
      flash("聊天内容不能为空。", "error", { title: "发送失败" });
      render();
      return;
    }

    state.chatSubmitting = true;
    render();

    try {
      await apiRequest("/api/chats/messages", {
        method: "POST",
        auth: true,
        body: {
          userId: state.activeChatUserId,
          content
        }
      });

      state.chatDraft.content = "";
      await refreshWorkspaceData();
      await refreshActiveChat(true);
      flash("消息已发送。", "success");
    } catch (error) {
      flash(error.message || "消息发送失败。", "error", { title: "发送失败" });
    } finally {
      state.chatSubmitting = false;
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Check-in module
  // ---------------------------------------------------------------------------

  async function submitCheckin() {
    const title = state.checkinDraft.title.trim();
    const frequency = state.checkinDraft.frequency.trim();

    if (!title) {
      flash("打卡项名字不能为空。", "error", { title: "创建失败" });
      render();
      return;
    }

    if (!frequency) {
      flash("请填写打卡频率。", "error", { title: "创建失败" });
      render();
      return;
    }

    try {
      await apiRequest("/api/checkins/items", {
        method: "POST",
        auth: true,
        body: {
          title,
          frequency,
          visibility: state.checkinDraft.visibility
        }
      });

      state.checkinDraft = {
        title: "",
        frequency: "每天",
        visibility: "private"
      };
      await refreshWorkspaceData();
      flash("新的打卡项已经创建。", "success");
    } catch (error) {
      flash(error.message || "创建打卡项失败，请稍后再试。", "error", { title: "创建失败" });
      render();
    }
  }

  async function completeCheckin(itemId) {
    if (!itemId) {
      return;
    }

    try {
      await apiRequest("/api/checkins/items/complete", {
        method: "POST",
        auth: true,
        body: {
          itemId
        }
      });

      await refreshWorkspaceData();
      flash("今天这项打卡已经记上了。", "success");
    } catch (error) {
      flash(error.message || "打卡失败，请稍后再试。", "error", { title: "打卡失败" });
      render();
    }
  }

  async function submitCheckinReminder() {
    if (!state.modal || state.modal.kind !== "checkinReminder") {
      return;
    }

    try {
      await apiRequest("/api/checkins/reminders", {
        method: "POST",
        auth: true,
        body: {
          itemId: state.modal.itemId,
          message: state.modal.message
        }
      });

      state.modal = null;
      await refreshWorkspaceData();
      flash("提醒已经发出，对方下次上线就能看到。", "success");
    } catch (error) {
      state.modal.error = error.message || "发送提醒失败，请稍后再试。";
      render();
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      await apiRequest("/api/notifications/read", {
        method: "POST",
        auth: true,
        body: notificationId ? { notificationId } : {}
      });

      await refreshWorkspaceData();
    } catch (error) {
      flash(error.message || "更新提醒状态失败。", "error", { title: "操作失败" });
      render();
    }
  }

  function findStateCheckinItem(itemId) {
    const modalCheckins =
      state.modal &&
      state.modal.kind === "userSpace" &&
      state.modal.space &&
      Array.isArray(state.modal.space.checkins)
        ? state.modal.space.checkins
        : [];

    return (
      state.checkins.mine.find((item) => item.id === itemId) ||
      state.checkins.community.find((item) => item.id === itemId) ||
      modalCheckins.find((item) => item.id === itemId) ||
      null
    );
  }

  // ---------------------------------------------------------------------------
  // Pomodoro module
  // ---------------------------------------------------------------------------

  function createDefaultTimerState() {
    return {
      mode: "focus",
      focusMinutes: 25,
      breakMinutes: 5,
      remainingSeconds: 25 * 60,
      isRunning: false,
      completedFocusCount: 0,
      lastTickAt: 0
    };
  }

  function startTimer() {
    if (state.timer.isRunning) {
      return;
    }

    state.timer.isRunning = true;
    state.timer.lastTickAt = Date.now();
    ensureTimerLoop();
    render();
  }

  function pauseTimer() {
    state.timer.isRunning = false;
    state.timer.lastTickAt = 0;
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
    render();
  }

  function resetTimer(mode) {
    state.timer.mode = mode || state.timer.mode;
    state.timer.remainingSeconds = getTimerDurationSeconds(state.timer.mode);
    state.timer.isRunning = false;
    state.timer.lastTickAt = 0;
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function switchTimerMode(mode) {
    state.timer.mode = mode === "break" ? "break" : "focus";
    state.timer.remainingSeconds = getTimerDurationSeconds(state.timer.mode);
    state.timer.isRunning = false;
    state.timer.lastTickAt = 0;
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function applyTimerPreset(focusMinutes, breakMinutes) {
    state.timer.focusMinutes = clampMinutes(focusMinutes, 25);
    state.timer.breakMinutes = clampMinutes(breakMinutes, 5);
    if (!state.timer.isRunning) {
      state.timer.remainingSeconds = getTimerDurationSeconds(state.timer.mode);
    }
  }

  function ensureTimerLoop() {
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
    }

    timerIntervalId = window.setInterval(() => {
      if (!state.timer.isRunning) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
        return;
      }

      const now = Date.now();
      const elapsedSeconds = Math.floor((now - state.timer.lastTickAt) / 1000);
      if (elapsedSeconds <= 0) {
        return;
      }

      state.timer.lastTickAt = now;
      state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds - elapsedSeconds);

      if (state.timer.remainingSeconds <= 0) {
        const finishedMode = state.timer.mode;
        if (finishedMode === "focus") {
          state.timer.completedFocusCount += 1;
        }
        state.timer.mode = finishedMode === "focus" ? "break" : "focus";
        state.timer.remainingSeconds = getTimerDurationSeconds(state.timer.mode);
        state.timer.lastTickAt = Date.now();
        state.toast = {
          type: finishedMode === "focus" ? "success" : "info",
          text:
            finishedMode === "focus"
              ? "一个番茄钟完成了，休息一下。"
              : "休息时间结束，准备进入下一轮专注。"
        };
        render();
        return;
      }

      if (state.currentUser && state.module === "timer") {
        render();
      }
    }, 1000);
  }

  function getTimerDurationSeconds(mode) {
    return (mode === "break" ? state.timer.breakMinutes : state.timer.focusMinutes) * 60;
  }

  function clampMinutes(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(1, Math.min(120, Math.round(parsed)));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function render() {
    let pageHtml = "";

    if (state.loading) {
      pageHtml = renderLoading();
    } else if (state.currentUser) {
      pageHtml = renderWorkspace(state.currentUser);
    } else {
      pageHtml = renderAuth();
    }

    app.innerHTML = pageHtml + renderToast() + renderModal();
  }

  function renderLoading() {
    return `
      <section class="loading-shell">
        <article class="panel loading-card">
          <p class="eyebrow">study_home</p>
          <h1 class="who-title">正在连接服务器</h1>
          <p class="section-desc">正在同步云端用户数据、地区选项和个人模块，请稍等一下。</p>
        </article>
      </section>
    `;
  }

  function renderAuth() {
    const selectedUser = state.users.find((user) => user.id === state.selectedUserId) || null;
    const hasUsers = state.users.length > 0;
    const showLogin = state.authMode === "login" && hasUsers;

    return `
      <section class="layout auth-layout ${showLogin ? "login-mode" : "register-mode"}">
        <article class="panel hero-panel">
          <div class="hero-top">
            <span class="brand">Wind & Butterfly</span>
            <span class="badge">多端登录 · 云端同步</span>
          </div>
          <div class="quote-wrap">
            <p class="eyebrow">个人博客首页</p>
            <h1 class="quote">
              <span>风可以吹走一片树叶，</span>
              <strong>但吹不走一只蝴蝶，</strong>
              <span>因为生命的力量在于不顺从。</span>
            </h1>
            <p class="quote-subline">
              现在账户数据会集中保存在服务器里，当前设备只记住登录态，所以同一个账户可以在不同设备登录。
            </p>
          </div>
          <div class="who-block">
            <h2 class="who-title">你是谁？</h2>
            <p class="who-text">
              先登录你的身份，再进入网站。注册时会设置密保问题，忘记密码时可以用来重置。
            </p>
          </div>
        </article>
        <section class="panel auth-panel">
          <div class="tabs" role="tablist" aria-label="登录方式">
            <button class="tab ${showLogin ? "active" : ""}" data-action="switchMode" data-mode="login" type="button">
              登录
            </button>
            <button class="tab ${!showLogin ? "active" : ""}" data-action="switchMode" data-mode="register" type="button">
              注册
            </button>
          </div>
          ${showLogin ? renderLoginUsersCard(selectedUser) : renderRegisterGuideCard()}
          <section class="card-block auth-main-card ${showLogin ? "" : "compact-card"}">
            ${showLogin ? renderLoginForm(selectedUser) : renderRegisterForm()}
          </section>
        </section>
      </section>
    `;
  }

  function renderLoginUsersCard(selectedUser) {
    return `
      <section class="card-block">
        <h2 class="section-title">选择账号</h2>
        <p class="section-desc">下面是已经注册过的账号，点头像即可切换登录对象。</p>
        ${state.users.length ? renderUserList(selectedUser) : `
          <div class="empty-box">
            <p>云端还没有用户。先注册一个名字、密码、密保问题和头像，你就能直接进入网站。</p>
          </div>
        `}
      </section>
    `;
  }

  function renderRegisterGuideCard() {
    return `
      <section class="card-block slim-card">
        <h2 class="section-title">欢迎您来到study_home</h2>
        <p class="section-desc">账户数据会保存在服务器，当前设备只缓存登录 token 和当前用户资料，不会再保存明文密码。</p>
      </section>
    `;
  }

  function renderUserList(selectedUser) {
    return `
      <div class="user-grid">
        ${state.users
          .map((user) => {
            const active = selectedUser && selectedUser.id === user.id;
            return `
              <button
                type="button"
                class="user-card ${active ? "active" : ""}"
                data-action="selectUser"
                data-user-id="${escapeHtml(user.id)}"
              >
                ${renderAvatar(user, "avatar")}
                <div class="user-meta">
                  <p class="user-name">${escapeHtml(user.name)}</p>
                  <p class="user-note">${active ? "准备登录这个身份" : "点击切换到这个身份"}</p>
                </div>
                <span class="user-tag">${active ? "当前选择" : "可登录"}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderLoginForm(selectedUser) {
    if (!selectedUser) {
      return `
        <h2 class="section-title">登录</h2>
        <p class="section-desc">先选择要登录的账号，再输入密码。</p>
      `;
    }

    return `
      <h2 class="section-title">登录 ${escapeHtml(selectedUser.name)}</h2>
      <p class="section-desc">密码会提交给服务器校验，当前设备只保存登录令牌，不保存明文密码。</p>
      <div class="upload-top profile-preview">
        ${renderAvatar(selectedUser, "avatar-large")}
        <div class="upload-copy">
          <strong>${escapeHtml(selectedUser.name)}</strong>
          <p>登录成功后，你会直接进入博客、打卡和番茄钟的工作区。</p>
        </div>
      </div>
      <form class="form" data-form="login">
        ${renderPasswordField({
          id: "login-password",
          name: "loginPassword",
          label: "密码",
          autocomplete: "current-password",
          placeholder: "输入这个账号的密码",
          value: state.loginDraft.password,
          visibilityKey: "login"
        })}
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">进入网站</button>
          <button class="btn btn-secondary" type="button" data-action="openRecovery">忘记密码</button>
          <button class="btn btn-secondary" type="button" data-action="switchMode" data-mode="register">去注册</button>
        </div>
      </form>
    `;
  }

  function renderRegisterForm() {
    const passwordHint = getPasswordHint();
    const confirmHint = getConfirmHint();

    return `
      <h2 class="section-title">注册账号</h2>
      <p class="section-desc">按顺序填好头像、用户名、密码和密保信息，账号创建后会直接保存在服务器。</p>
      <form class="form register-form register-stack" data-form="register">
        ${renderRegisterAvatarField()}
        <div class="field">
          <label for="register-name">用户名</label>
          <input
            id="register-name"
            name="registerName"
            type="text"
            maxlength="18"
            autocomplete="nickname"
            placeholder="例如：Disaster"
            value="${escapeHtml(state.registerDraft.name)}"
          />
        </div>
        ${renderPasswordField({
          id: "register-password",
          name: "registerPassword",
          label: "密码",
          autocomplete: "new-password",
          placeholder: "请输入密码",
          value: state.registerDraft.password,
          visibilityKey: "register",
          hint: passwordHint.message,
          hintTone: passwordHint.tone
        })}
        ${renderPasswordField({
          id: "register-confirm-password",
          name: "registerConfirmPassword",
          label: "确认密码",
          autocomplete: "new-password",
          placeholder: "请再次输入密码",
          value: state.registerDraft.confirmPassword,
          visibilityKey: "registerConfirm",
          hint: confirmHint.message,
          hintTone: confirmHint.tone
        })}
        <div class="field">
          <label for="register-security-question">密保问题</label>
          <input
            id="register-security-question"
            name="registerSecurityQuestion"
            type="text"
            maxlength="60"
            autocomplete="off"
            placeholder="例如：我最喜欢的老师叫什么？"
            value="${escapeHtml(state.registerDraft.securityQuestion)}"
          />
        </div>
        <div class="field">
          <label for="register-security-answer">密保答案</label>
          <input
            id="register-security-answer"
            name="registerSecurityAnswer"
            type="text"
            maxlength="60"
            autocomplete="off"
            placeholder="输入密保答案"
            value="${escapeHtml(state.registerDraft.securityAnswer)}"
          />
        </div>
        <div class="form-actions register-actions">
          <button class="btn btn-accent" type="submit" ${state.avatarProcessing ? "disabled" : ""}>
            ${state.avatarProcessing ? "头像处理中..." : "创建账号"}
          </button>
          ${state.users.length ? `<button class="btn btn-secondary" type="button" data-action="switchMode" data-mode="login">返回登录</button>` : ""}
        </div>
      </form>
    `;
  }

  function renderRegisterAvatarField() {
    const preview = state.registerDraft.avatar
      ? `<img class="avatar-upload-image" src="${state.registerDraft.avatar}" alt="头像预览" />`
      : `<div class="avatar-upload-placeholder">上传头像</div>`;

    return `
      <div class="field">
        <label for="register-avatar">头像上传</label>
        <div class="avatar-upload-field">
          <label class="avatar-upload-circle" for="register-avatar">
            ${preview}
          </label>
          <div class="avatar-upload-copy">
            <strong>${state.avatarProcessing ? "头像处理中..." : "点击圆形区域上传头像"}</strong>
            <p>上传前是圆形占位，上传后会自动压缩分辨率和体积，再提交到服务器保存。</p>
            <input id="register-avatar" name="registerAvatar" type="file" accept="image/*" />
          </div>
        </div>
      </div>
    `;
  }

  function renderProfileAvatarField(currentUser) {
    const preview = state.profileDraft.avatar
      ? `<img class="avatar-upload-image" src="${state.profileDraft.avatar}" alt="头像预览" />`
      : `<div class="avatar-upload-placeholder">${escapeHtml((currentUser.name || "你").slice(0, 1) || "你")}</div>`;

    return `
      <div class="field field-span-2">
        <label for="profile-avatar">头像</label>
        <div class="avatar-upload-field profile-avatar-upload">
          <label class="avatar-upload-circle" for="profile-avatar">
            ${preview}
          </label>
          <div class="avatar-upload-copy">
            <strong>${state.profileAvatarProcessing ? "头像处理中..." : "点击圆形区域更换头像"}</strong>
            <p>会先自动压缩图片，完成后点击下面的保存资料，才会同步到服务器。</p>
            <p>当前账号：${escapeHtml(currentUser.name || "未命名用户")}</p>
            <input id="profile-avatar" name="profileAvatar" type="file" accept="image/*" />
          </div>
        </div>
      </div>
    `;
  }

  function renderWorkspace(currentUser) {
    return `
      <section class="layout workspace-layout">
        <aside class="panel workspace-sidebar">
          <button class="workspace-profile-button" type="button" data-action="switchModule" data-module="profile">
            ${renderAvatar(currentUser, "profile-avatar")}
            <span class="workspace-profile-caption">点击进入个人资料</span>
          </button>
          <div class="workspace-user-copy">
            <h1>${escapeHtml(currentUser.name)}</h1>
            <p>${escapeHtml(getLocationSummary(currentUser.profile && currentUser.profile.location))}</p>
          </div>
          <div class="module-nav">
            ${MODULES.map((item) => renderModuleButton(item)).join("")}
          </div>
          <div class="workspace-side-actions">
            <button class="btn btn-secondary" type="button" data-action="requestSwitchUser">切换用户</button>
            <button class="btn btn-secondary" type="button" data-action="requestLogout">退出登录</button>
            <button class="btn btn-danger" type="button" data-action="requestDeleteUser">删除当前用户</button>
          </div>
          ${renderNotificationsPanel()}
        </aside>
        <section class="panel workspace-main">
          ${state.workspaceLoading ? renderWorkspaceLoading() : renderActiveModule(currentUser)}
        </section>
      </section>
    `;
  }

  function renderModuleButton(item) {
    const badgeCount = getModuleBadgeCount(item.key);

    return `
      <button
        class="module-button ${state.module === item.key ? "active" : ""}"
        type="button"
        data-action="switchModule"
        data-module="${escapeHtml(item.key)}"
      >
        <span>${escapeHtml(item.label)}</span>
        ${badgeCount ? `<span class="module-badge">${escapeHtml(String(Math.min(badgeCount, 99)))}</span>` : ""}
      </button>
    `;
  }

  function renderWorkspaceLoading() {
    return `
      <section class="workspace-loading">
        <p class="eyebrow">数据同步中</p>
        <h2 class="section-title">正在拉取博客、打卡和提醒</h2>
        <p class="section-desc">这一步只会持续很短时间，加载完成后你就能继续操作。</p>
      </section>
    `;
  }

  function renderActiveModule(currentUser) {
    if (state.module === "profile") {
      return renderProfileModule(currentUser);
    }

    if (state.module === "chat") {
      return renderChatModule();
    }

    if (state.module === "checkin") {
      return renderCheckinModule();
    }

    if (state.module === "timer") {
      return renderTimerModule();
    }

    return renderBlogModule();
  }

  function renderNotificationsPanel() {
    const unreadCount = getUnreadNotificationsCount();
    const notifications = state.notifications.slice(0, 8);

    return `
      <section class="notification-panel">
        <div class="notification-head">
          <div>
            <h2>上线提醒</h2>
            <p>${unreadCount ? "你有 " + unreadCount + " 条未读提醒" : "暂时没有新的提醒"}</p>
          </div>
          ${unreadCount ? `<button class="btn btn-secondary btn-small" type="button" data-action="markAllNotificationsRead">全部已读</button>` : ""}
        </div>
        ${notifications.length ? `
          <div class="notification-list">
            ${notifications.map((notification) => renderNotificationCard(notification)).join("")}
          </div>
        ` : `
          <div class="empty-box compact-empty">
            <p>当别人查看你的公开打卡计划并给你留言提醒时，这里会在你下次上线时显示。</p>
          </div>
        `}
      </section>
    `;
  }

  function renderNotificationCard(notification) {
    const unread = !notification.readAt;
    const senderName = notification.sender && notification.sender.name ? notification.sender.name : "有人";
    const canChatFromNotification =
      Boolean(notification.canOpenChat) ||
      Boolean(notification.type === "friend-accept" && notification.sender && notification.sender.id);

    return `
      <article class="notification-card ${unread ? "unread" : ""}">
        <div class="notification-meta">
          <strong>${escapeHtml(senderName)}</strong>
          <span>${escapeHtml(formatDateTime(notification.createdAt))}</span>
        </div>
        <p class="notification-text">${escapeHtml(notification.message || "")}</p>
        ${notification.itemTitle ? `<p class="notification-item">关联计划：${escapeHtml(notification.itemTitle)}</p>` : ""}
        ${notification.blogTitle ? `<p class="notification-item">关联博客：${escapeHtml(notification.blogTitle)}</p>` : ""}
        <div class="notification-actions">
          ${notification.blogId ? `
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="openNotificationBlog"
              data-blog-id="${escapeHtml(notification.blogId)}"
            >
              查看博客
            </button>
          ` : ""}
          ${notification.canAcceptRequest ? `
            <button
              class="btn btn-primary btn-small"
              type="button"
              data-action="acceptFriendRequest"
              data-request-id="${escapeHtml(notification.requestId || "")}"
            >
              同意好友
            </button>
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="rejectFriendRequest"
              data-request-id="${escapeHtml(notification.requestId || "")}"
            >
              拒绝
            </button>
          ` : ""}
          ${canChatFromNotification ? `
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="openChat"
              data-user-id="${escapeHtml((notification.sender && notification.sender.id) || "")}"
            >
              去聊天
            </button>
          ` : ""}
          ${unread ? `
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="markNotificationRead"
              data-notification-id="${escapeHtml(notification.id)}"
            >
              标记已读
            </button>
          ` : `<span class="notification-status">已读</span>`}
        </div>
      </article>
    `;
  }

  function renderBlogModule() {
    const posts = state.blogScope === "mine" ? state.blogs.mine : state.blogs.community;
    const currentUserId = state.currentUser ? state.currentUser.id : "";
    const scopeTitle = state.blogScope === "mine" ? "我的空间" : "社区动态";
    const scopeDescription =
      state.blogScope === "mine"
        ? "这里展示你发布过的全部博客。你可以管理自己的内容，也可以随时切回社区。"
        : "进入博客后默认显示社区流。过长内容会自动折叠，方便快速浏览。";

    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Blog</p>
          <h2 class="module-title">博客空间</h2>
          <p class="section-desc">这里用 Markdown 写博客并上传照片。图片会保存到服务器的 data/uploads/blogs，后面迁移数据库或对象存储也更方便。</p>
        </header>
        <div class="module-grid blog-grid">
          <section class="card-block module-card blog-compose-card">
            <h3 class="section-title">发布一篇博客</h3>
            <p class="section-desc">支持常用 Markdown 语法，例如标题、列表、加粗、代码块。</p>
            <form class="form" data-form="blog">
              <div class="field">
                <label for="blog-title">标题</label>
                <input
                  id="blog-title"
                  name="blogTitle"
                  type="text"
                  maxlength="80"
                  placeholder="给这篇博客起一个名字"
                  value="${escapeHtml(state.blogDraft.title)}"
                />
              </div>
              <div class="field">
                <label for="blog-content">Markdown 内容</label>
                <textarea
                  id="blog-content"
                  name="blogContent"
                  rows="12"
                  maxlength="20000"
                  placeholder="# 今天想写什么&#10;&#10>- 第一条&#10;- 第二条&#10;&#10> 写点你想留住的东西。"
                >${escapeHtml(state.blogDraft.content)}</textarea>
                <p class="field-hint">可以写 # 标题、- 列表、**加粗** 和代码块。</p>
              </div>
              ${renderSelectField({
                id: "blog-visibility",
                name: "blogVisibility",
                label: "可见范围",
                value: state.blogDraft.visibility,
                placeholder: "请选择可见范围",
                options: BLOG_VISIBILITY_OPTIONS
              })}
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">发布博客</button>
              </div>
            </form>
            <section class="markdown-preview-wrap">
              <div class="preview-head">
                <h4>发布预览</h4>
                <span>${escapeHtml(state.blogDraft.visibility === "private" ? "仅自己可见" : "全部可见")}</span>
              </div>
              <article class="markdown-preview">
                <h5 id="blog-preview-title">${escapeHtml(state.blogDraft.title.trim() || "还没有标题")}</h5>
                <div id="blog-preview" class="markdown-content">
                  ${renderMarkdown(state.blogDraft.content)}
                </div>
              </article>
            </section>
          </section>
          <section class="card-block module-card blog-feed-card">
            <div class="feed-toolbar">
              <div class="segmented">
                <button
                  class="segment ${state.blogScope === "community" ? "active" : ""}"
                  type="button"
                  data-action="switchBlogScope"
                  data-scope="community"
                >
                  社区
                </button>
                <button
                  class="segment ${state.blogScope === "mine" ? "active" : ""}"
                  type="button"
                  data-action="switchBlogScope"
                  data-scope="mine"
                >
                  个人主页
                </button>
              </div>
              <span class="feed-count">${escapeHtml(String(posts.length))} 篇</span>
            </div>
            ${posts.length ? `
              <div class="feed-list">
                ${posts.map((post) => renderBlogPost(post)).join("")}
              </div>
            ` : renderEmptyState(
              state.blogScope === "mine" ? "你的主页还没有内容" : "社区里还没有公开博客",
              state.blogScope === "mine"
                ? "先在左侧发布一篇 Markdown 博客，发布后这里会显示你的全部文章。"
                : "等有人发布公开博客后，这里就会出现社区内容。"
            )}
          </section>
        </div>
      </section>
    `;
  }

  function renderBlogPost(post) {
    const authorName = post.author && post.author.name ? post.author.name : "未知作者";
    const authorId = post.author && post.author.id ? post.author.id : "";
    const visibilityText = post.visibility === "private" ? "仅自己可见" : "全部可见";

    return `
      <article class="post-card">
        <div class="post-meta">
          <button
            class="post-author-button"
            type="button"
            data-action="openUserSpace"
            data-user-id="${escapeHtml(authorId)}"
            ${authorId ? "" : "disabled"}
          >
            <span class="post-author">
              ${renderAvatar(post.author || { name: authorName }, "avatar")}
              <span>
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(formatDateTime(post.createdAt))}</span>
              </span>
            </span>
          </button>
          ${state.blogScope === "mine" ? `<span class="visibility-badge">${escapeHtml(visibilityText)}</span>` : ""}
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <div class="markdown-content">
          ${renderMarkdown(post.content)}
        </div>
        <div class="post-footer">
          <div class="badge-row">
            <span class="visibility-badge">点赞 ${escapeHtml(String(post.likeCount || 0))}</span>
            <span class="visibility-badge">评论 ${escapeHtml(String(post.commentCount || 0))}</span>
          </div>
          <div class="form-actions">
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="openBlogDetail"
              data-blog-id="${escapeHtml(post.id)}"
            >
              详细查看
            </button>
            ${authorId ? `
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-action="openUserSpace"
                data-user-id="${escapeHtml(authorId)}"
              >
                作者主页
              </button>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function renderBlogDetailModal(modal) {
    const blog = modal.blog;
    const authorName = blog && blog.author && blog.author.name ? blog.author.name : "未知作者";
    const authorId = blog && blog.author && blog.author.id ? blog.author.id : "";

    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">博客详情</p>
          ${modal.loading ? `
            <h2 class="modal-title" id="modal-title">正在加载内容</h2>
            <p class="modal-text">博客正文、点赞和评论正在同步中。</p>
          ` : blog ? `
            <div class="blog-detail-head">
              <div>
                <h2 class="modal-title" id="modal-title">${escapeHtml(blog.title)}</h2>
                <p class="modal-text">发布于 ${escapeHtml(formatDateTime(blog.createdAt))}</p>
              </div>
              ${authorId ? `
                <button
                  class="btn btn-secondary btn-small"
                  type="button"
                  data-action="openUserSpace"
                  data-user-id="${escapeHtml(authorId)}"
                >
                  查看作者主页
                </button>
              ` : ""}
            </div>
            <div class="blog-detail-meta">
              <button
                class="blog-detail-author"
                type="button"
                data-action="openUserSpace"
                data-user-id="${escapeHtml(authorId)}"
                ${authorId ? "" : "disabled"}
              >
                ${renderAvatar(blog.author || { name: authorName }, "avatar")}
                <span>
                  <strong>${escapeHtml(authorName)}</strong>
                  <span>${escapeHtml(blog.visibility === "private" ? "仅自己可见" : "全部可见")}</span>
                </span>
              </button>
              <div class="badge-row">
                <span class="visibility-badge">点赞 ${escapeHtml(String(blog.likeCount || 0))}</span>
                <span class="visibility-badge">评论 ${escapeHtml(String(blog.commentCount || 0))}</span>
              </div>
            </div>
            <article class="blog-detail-body markdown-content">
              ${renderMarkdown(blog.content)}
            </article>
            <div class="blog-detail-actions">
              <button
                class="btn ${blog.likedByMe ? "btn-accent" : "btn-secondary"}"
                type="button"
                data-action="toggleBlogLike"
                data-blog-id="${escapeHtml(blog.id)}"
              >
                ${escapeHtml(blog.likedByMe ? "取消点赞" : "点赞")}
              </button>
            </div>
            <section class="comment-section">
              <div class="comment-head">
                <h3>评论区</h3>
                <span>${escapeHtml(String(blog.commentCount || 0))} 条评论</span>
              </div>
              <div class="field">
                <label for="blog-comment-content">写一条评论</label>
                <textarea
                  id="blog-comment-content"
                  name="blogCommentContent"
                  rows="4"
                  maxlength="600"
                  placeholder="写下你的想法。"
                >${escapeHtml(modal.commentContent || "")}</textarea>
              </div>
              ${modal.error ? `<p class="field-hint error">${escapeHtml(modal.error)}</p>` : ""}
              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  data-action="submitBlogComment"
                  ${modal.commentSubmitting ? "disabled" : ""}
                >
                  ${escapeHtml(modal.commentSubmitting ? "发布中..." : "发布评论")}
                </button>
              </div>
              ${blog.comments && blog.comments.length ? `
                <div class="comment-list">
                  ${blog.comments.map((comment) => renderBlogComment(comment)).join("")}
                </div>
              ` : `
                <div class="empty-box compact-empty">
                  <p>还没有评论，来写第一条吧。</p>
                </div>
              `}
            </section>
          ` : `
            <h2 class="modal-title" id="modal-title">没有找到内容</h2>
            <p class="modal-text">这篇博客可能已经不可见，或者被删除了。</p>
          `}
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-action="dismissModal">关闭</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderBlogComment(comment) {
    const authorName = comment && comment.author && comment.author.name ? comment.author.name : "匿名用户";
    const authorId = comment && comment.author && comment.author.id ? comment.author.id : "";

    return `
      <article class="comment-card">
        <div class="comment-meta">
          <button
            class="comment-author"
            type="button"
            data-action="openUserSpace"
            data-user-id="${escapeHtml(authorId)}"
            ${authorId ? "" : "disabled"}
          >
            ${renderAvatar(comment.author || { name: authorName }, "avatar")}
            <span>
              <strong>${escapeHtml(authorName)}</strong>
              <span>${escapeHtml(formatDateTime(comment.createdAt))}</span>
            </span>
          </button>
        </div>
        <p class="comment-content">${escapeHtml(comment.content || "")}</p>
      </article>
    `;
  }

  function renderUserSpaceModal(modal) {
    const space = modal.space;
    const user = space && space.user ? space.user : null;

    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">个人主页</p>
          ${modal.loading ? `
            <h2 class="modal-title" id="modal-title">正在打开主页</h2>
            <p class="modal-text">用户资料、公开博客和公开计划正在加载中。</p>
          ` : space && user ? `
            <div class="user-space-head">
              <div class="user-space-identity">
                ${renderAvatar(user, "avatar-large")}
                <div>
                  <h2 class="modal-title" id="modal-title">${escapeHtml(user.name || "未命名用户")}</h2>
                  <p class="modal-text no-margin">${escapeHtml(getLocationSummary(user.profile && user.profile.location))}</p>
                </div>
              </div>
              ${space.isSelf ? `<span class="visibility-badge">这是你的主页</span>` : `<span class="visibility-badge">公开主页</span>`}
            </div>
            <div class="profile-summary-row">
              <span class="portal-chip"><strong>性别:</strong> ${escapeHtml(getReadableGender(user.profile && user.profile.gender))}</span>
              <span class="portal-chip"><strong>地区:</strong> ${escapeHtml(getLocationSummary(user.profile && user.profile.location))}</span>
              <span class="portal-chip"><strong>介绍:</strong> ${escapeHtml(getReadableBio(user.profile && user.profile.bio))}</span>
            </div>
            <div class="user-space-grid">
              <section class="card-block">
                <div class="feed-toolbar">
                  <h3 class="section-title no-margin">公开博客</h3>
                  <span class="feed-count">${escapeHtml(String((space.blogs || []).length))} 篇</span>
                </div>
                ${(space.blogs || []).length ? `
                  <div class="feed-list user-space-feed">
                    ${(space.blogs || []).map((blog) => renderUserSpaceBlogCard(blog)).join("")}
                  </div>
                ` : renderEmptyState("还没有公开博客", "对方发布公开博客后，这里会显示出来。")}
              </section>
              <section class="card-block">
                <div class="feed-toolbar">
                  <h3 class="section-title no-margin">公开计划</h3>
                  <span class="feed-count">${escapeHtml(String((space.checkins || []).length))} 项</span>
                </div>
                ${(space.checkins || []).length ? `
                  <div class="checkin-list">
                    ${(space.checkins || []).map((item) => renderUserSpaceCheckinCard(item)).join("")}
                  </div>
                ` : renderEmptyState("还没有公开计划", "对方把打卡项设为可见后，这里就会出现。")}
              </section>
            </div>
          ` : `
            <h2 class="modal-title" id="modal-title">没有找到主页</h2>
            <p class="modal-text">${escapeHtml(modal.error || "这个用户可能不存在。")}</p>
          `}
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-action="dismissModal">关闭</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderUserSpaceBlogCard(blog) {
    return `
      <article class="user-space-blog-card">
        <div class="feed-toolbar">
          <h4 class="section-title no-margin">${escapeHtml(blog.title || "未命名博客")}</h4>
          <span class="feed-count">${escapeHtml(formatDate(blog.createdAt))}</span>
        </div>
        <div class="badge-row">
          <span class="visibility-badge">点赞 ${escapeHtml(String(blog.likeCount || 0))}</span>
          <span class="visibility-badge">评论 ${escapeHtml(String(blog.commentCount || 0))}</span>
        </div>
        <div class="form-actions">
          <button
            class="btn btn-secondary btn-small"
            type="button"
            data-action="openBlogDetail"
            data-blog-id="${escapeHtml(blog.id)}"
          >
            详细查看
          </button>
        </div>
      </article>
    `;
  }

  function renderUserSpaceCheckinCard(item) {
    const ownerName = item.owner && item.owner.name ? item.owner.name : "匿名用户";

    return `
      <article class="checkin-card">
        <div class="checkin-card-top">
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.frequency)}</p>
          </div>
          <span class="status-badge ${item.completedToday ? "done" : "pending"}">
            ${escapeHtml(item.completedToday ? "今日已完成" : "今日未完成")}
          </span>
        </div>
        <div class="badge-row">
          <span class="visibility-badge">${escapeHtml(ownerName)}</span>
          <span class="visibility-badge">累计 ${escapeHtml(String(item.completionCount || 0))} 次</span>
        </div>
        <div class="form-actions">
          <button
            class="btn btn-secondary btn-small"
            type="button"
            data-action="openReminderModal"
            data-item-id="${escapeHtml(item.id)}"
            ${item.completedToday ? "disabled" : ""}
          >
            ${escapeHtml(item.completedToday ? "对方已完成" : "提醒对方")}
          </button>
          <button
            class="btn btn-secondary btn-small"
            type="button"
            data-action="openCheckinHistory"
            data-item-id="${escapeHtml(item.id)}"
          >
            查看完成情况
          </button>
        </div>
      </article>
    `;
  }

  function renderBlogModule() {
    const posts = state.blogScope === "mine" ? state.blogs.mine : state.blogs.community;
    const currentUserId = state.currentUser ? state.currentUser.id : "";
    const scopeTitle = state.blogScope === "mine" ? "我的空间" : "社区动态";
    const scopeDescription =
      state.blogScope === "mine"
        ? "这里展示你发布过的全部博客。你可以管理自己的内容，也可以随时切回社区。"
        : "进入博客后默认显示社区流。过长内容会自动折叠，方便快速浏览。";

    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Blog</p>
          <h2 class="module-title">博客空间</h2>
          <p class="section-desc">这里用 Markdown 写博客并上传照片。图片会保存到服务器的 data/uploads/blogs，后面迁移数据库或对象存储也更方便。</p>
        </header>
        <section class="card-block module-card blog-feed-card blog-stream-card">
          <div class="blog-toolbar">
            <div class="segmented">
              <button
                class="segment ${state.blogScope === "community" ? "active" : ""}"
                type="button"
                data-action="switchBlogScope"
                data-scope="community"
              >
                社区
              </button>
              <button
                class="segment ${state.blogScope === "mine" ? "active" : ""}"
                type="button"
                data-action="switchBlogScope"
                data-scope="mine"
              >
                我的空间
              </button>
            </div>
            <div class="blog-toolbar-actions">
              <button class="btn btn-primary" type="button" data-action="openPublishBlog">发布博客</button>
              ${currentUserId ? `
                <button
                  class="btn btn-secondary"
                  type="button"
                  data-action="openUserSpace"
                  data-user-id="${escapeHtml(currentUserId)}"
                >
                  个人主页
                </button>
              ` : ""}
            </div>
          </div>
          <div class="feed-toolbar">
            <div>
              <h3 class="section-title no-margin">${escapeHtml(scopeTitle)}</h3>
              <p class="section-desc no-margin">${escapeHtml(scopeDescription)}</p>
            </div>
            <span class="feed-count">${escapeHtml(String(posts.length))} 篇</span>
          </div>
          ${posts.length ? `
            <div class="feed-list blog-feed-list">
              ${posts.map((post) => renderBlogPost(post)).join("")}
            </div>
          ` : renderEmptyState(
            state.blogScope === "mine" ? "你的空间还没有内容" : "社区里还没有公开博客",
            state.blogScope === "mine"
              ? "点击右上角发布博客，第一篇文章会直接出现在这里。"
              : "等有人发布公开博客后，这里就会出现社区内容。"
          )}
        </section>
      </section>
    `;
  }

  function renderBlogEditor() {
    return `
      <form class="form" data-form="blog">
        <div class="field">
          <label for="blog-title">标题</label>
          <input
            id="blog-title"
            name="blogTitle"
            type="text"
            maxlength="80"
            placeholder="给这篇博客起一个名字"
            value="${escapeHtml(state.blogDraft.title)}"
          />
        </div>
        <div class="field">
          <label for="blog-image-upload">照片</label>
          <div class="blog-upload-row">
            <input
              id="blog-image-upload"
              name="blogImageUpload"
              type="file"
              accept="image/*"
              ${state.blogImageUploading ? "disabled" : ""}
            />
            <span class="field-hint no-margin">上传后会保存到服务器的 data/uploads/blogs，并自动插入正文。</span>
          </div>
          ${renderBlogImageList()}
        </div>
        <div class="field">
          <label for="blog-content">Markdown 内容</label>
          <textarea
            id="blog-content"
            name="blogContent"
            rows="12"
            maxlength="20000"
            placeholder="# 今天想写什么&#10;&#10;- 第一条&#10;- 第二条&#10;&#10> 写点你想留住的东西。"
          >${escapeHtml(state.blogDraft.content)}</textarea>
          <p class="field-hint">可以写 # 标题、- 列表、**加粗**、代码块和图片。</p>
        </div>
        ${renderSelectField({
          id: "blog-visibility",
          name: "blogVisibility",
          label: "可见范围",
          value: state.blogDraft.visibility,
          placeholder: "请选择可见范围",
          options: BLOG_VISIBILITY_OPTIONS
        })}
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" ${state.blogImageUploading ? "disabled" : ""}>
            ${state.blogImageUploading ? "图片处理中..." : "发布博客"}
          </button>
          <button class="btn btn-secondary" type="button" data-action="dismissModal">稍后再发</button>
        </div>
      </form>
      <section class="markdown-preview-wrap">
        <div class="preview-head">
          <h4>发布预览</h4>
          <span>${escapeHtml(state.blogDraft.visibility === "private" ? "仅自己可见" : "全部可见")}</span>
        </div>
        <article class="markdown-preview">
          <h5 id="blog-preview-title">${escapeHtml(state.blogDraft.title.trim() || "还没有标题")}</h5>
          <div id="blog-preview" class="markdown-content">
            ${renderMarkdown(state.blogDraft.content)}
          </div>
        </article>
      </section>
    `;
  }

  function renderBlogImageList() {
    if (!state.blogDraft.imageUrls.length) {
      return "";
    }

    return `
      <div class="blog-image-strip">
        ${state.blogDraft.imageUrls
          .map((url) => {
            const safeUrl = getSafeMarkdownUrl(url);
            if (!safeUrl) {
              return "";
            }

            return `
              <article class="blog-image-chip">
                <img src="${safeUrl}" alt="已上传博客图片" loading="lazy" />
                <button
                  class="btn btn-secondary btn-small"
                  type="button"
                  data-action="removeBlogImage"
                  data-url="${escapeHtml(url)}"
                >
                  移除
                </button>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderPublishBlogModal() {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card modal-card-wide modal-card-blog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">发布博客</p>
          <h2 class="modal-title" id="modal-title">写一篇新的博客</h2>
          <p class="modal-text">这里优先保留文本内容和图片 URL，方便你后面继续迁移到数据库、对象存储或更完整的编辑器。</p>
          ${renderBlogEditor()}
        </section>
      </div>
    `;
  }

  function renderBlogPost(post) {
    const authorName = post.author && post.author.name ? post.author.name : "未知作者";
    const authorId = post.author && post.author.id ? post.author.id : "";
    const visibilityText = post.visibility === "private" ? "仅自己可见" : "全部可见";
    const isExpanded = Boolean(state.expandedBlogIds[post.id]);
    const canDelete = Boolean(state.currentUser && state.currentUser.id === post.userId);

    return `
      <article class="post-card">
        <div class="post-meta">
          <button
            class="post-author-button"
            type="button"
            data-action="openUserSpace"
            data-user-id="${escapeHtml(authorId)}"
            ${authorId ? "" : "disabled"}
          >
            <span class="post-author">
              ${renderAvatar(post.author || { name: authorName }, "avatar")}
              <span>
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(formatDateTime(post.createdAt))}</span>
              </span>
            </span>
          </button>
          <div class="badge-row">
            ${state.blogScope === "mine" ? `<span class="visibility-badge">${escapeHtml(visibilityText)}</span>` : ""}
            ${post.isLong ? `<span class="visibility-badge">${escapeHtml(isExpanded ? "已展开" : "已折叠")}</span>` : ""}
          </div>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        ${renderBlogPostBody(post, isExpanded)}
        <div class="post-footer">
          <div class="badge-row">
            <span class="visibility-badge">点赞 ${escapeHtml(String(post.likeCount || 0))}</span>
            <span class="visibility-badge">评论 ${escapeHtml(String(post.commentCount || 0))}</span>
          </div>
          <div class="form-actions">
            ${post.isLong ? `
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-action="toggleBlogExpand"
                data-blog-id="${escapeHtml(post.id)}"
              >
                ${escapeHtml(isExpanded ? "收起内容" : "展开全文")}
              </button>
            ` : ""}
            <button
              class="btn btn-secondary btn-small"
              type="button"
              data-action="openBlogDetail"
              data-blog-id="${escapeHtml(post.id)}"
            >
              详细查看
            </button>
            ${authorId ? `
              <button
                class="btn btn-secondary btn-small"
                type="button"
                data-action="openUserSpace"
                data-user-id="${escapeHtml(authorId)}"
              >
                作者主页
              </button>
            ` : ""}
            ${canDelete ? `
              <button
                class="btn btn-danger btn-small"
                type="button"
                data-action="requestDeleteBlog"
                data-blog-id="${escapeHtml(post.id)}"
              >
                删除
              </button>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function renderBlogPostBody(post, isExpanded) {
    if (!post.isLong || isExpanded) {
      return `
        <div class="markdown-content">
          ${renderMarkdown(post.content)}
        </div>
      `;
    }

    const teaserImage = Array.isArray(post.imageUrls) && post.imageUrls.length ? getSafeMarkdownUrl(post.imageUrls[0]) : "";
    const previewText =
      trimTextContent(post.contentPreview) ||
      (teaserImage ? "这篇博客包含图片内容，点击展开后可以查看完整正文和原图。" : "这篇博客内容较长，点击展开全文继续阅读。");

    return `
      <div class="post-preview-body">
        <p class="post-preview-text">${escapeHtml(previewText)}</p>
        ${teaserImage ? `<img class="post-preview-image" src="${teaserImage}" alt="${escapeHtml(post.title || "博客预览图片")}" loading="lazy" />` : ""}
      </div>
    `;
  }

  function renderBlogDetailModal(modal) {
    const blog = modal.blog;
    const authorName = blog && blog.author && blog.author.name ? blog.author.name : "未知作者";
    const authorId = blog && blog.author && blog.author.id ? blog.author.id : "";
    const canDelete = Boolean(blog && state.currentUser && state.currentUser.id === blog.userId);

    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">博客详情</p>
          ${modal.loading ? `
            <h2 class="modal-title" id="modal-title">正在加载内容</h2>
            <p class="modal-text">博客正文、点赞和评论正在同步中。</p>
          ` : blog ? `
            <div class="blog-detail-head">
              <div>
                <h2 class="modal-title" id="modal-title">${escapeHtml(blog.title)}</h2>
                <p class="modal-text">发布于 ${escapeHtml(formatDateTime(blog.createdAt))}</p>
              </div>
              ${authorId ? `
                <button
                  class="btn btn-secondary btn-small"
                  type="button"
                  data-action="openUserSpace"
                  data-user-id="${escapeHtml(authorId)}"
                >
                  查看作者主页
                </button>
              ` : ""}
            </div>
            <div class="blog-detail-meta">
              <button
                class="blog-detail-author"
                type="button"
                data-action="openUserSpace"
                data-user-id="${escapeHtml(authorId)}"
                ${authorId ? "" : "disabled"}
              >
                ${renderAvatar(blog.author || { name: authorName }, "avatar")}
                <span>
                  <strong>${escapeHtml(authorName)}</strong>
                  <span>${escapeHtml(blog.visibility === "private" ? "仅自己可见" : "全部可见")}</span>
                </span>
              </button>
              <div class="badge-row">
                <span class="visibility-badge">点赞 ${escapeHtml(String(blog.likeCount || 0))}</span>
                <span class="visibility-badge">评论 ${escapeHtml(String(blog.commentCount || 0))}</span>
              </div>
            </div>
            <article class="blog-detail-body markdown-content">
              ${renderMarkdown(blog.content)}
            </article>
            <div class="blog-detail-actions">
              <button
                class="btn ${blog.likedByMe ? "btn-accent" : "btn-secondary"}"
                type="button"
                data-action="toggleBlogLike"
                data-blog-id="${escapeHtml(blog.id)}"
              >
                ${escapeHtml(blog.likedByMe ? "取消点赞" : "点赞")}
              </button>
              ${canDelete ? `
                <button
                  class="btn btn-danger"
                  type="button"
                  data-action="requestDeleteBlog"
                  data-blog-id="${escapeHtml(blog.id)}"
                >
                  删除博客
                </button>
              ` : ""}
            </div>
            <section class="comment-section">
              <div class="comment-head">
                <h3>评论区</h3>
                <span>${escapeHtml(String(blog.commentCount || 0))} 条评论</span>
              </div>
              <div class="field">
                <label for="blog-comment-content">写一条评论</label>
                <textarea
                  id="blog-comment-content"
                  name="blogCommentContent"
                  rows="4"
                  maxlength="600"
                  placeholder="写下你的想法。"
                >${escapeHtml(modal.commentContent || "")}</textarea>
              </div>
              ${modal.error ? `<p class="field-hint error">${escapeHtml(modal.error)}</p>` : ""}
              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  type="button"
                  data-action="submitBlogComment"
                  ${modal.commentSubmitting ? "disabled" : ""}
                >
                  ${escapeHtml(modal.commentSubmitting ? "发布中..." : "发布评论")}
                </button>
              </div>
              ${blog.comments && blog.comments.length ? `
                <div class="comment-list">
                  ${blog.comments.map((comment) => renderBlogComment(comment)).join("")}
                </div>
              ` : `
                <div class="empty-box compact-empty">
                  <p>还没有评论，来写第一条吧。</p>
                </div>
              `}
            </section>
          ` : `
            <h2 class="modal-title" id="modal-title">没有找到内容</h2>
            <p class="modal-text">这篇博客可能已经不可见，或者被删除了。</p>
          `}
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-action="dismissModal">关闭</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderUserSpaceModal(modal) {
    const space = modal.space;
    const user = space && space.user ? space.user : null;
    const canSeeSharedCheckins = Boolean(space && (space.isSelf || (space.friendship && space.friendship.status === "friends")));

    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">个人主页</p>
          ${modal.loading ? `
            <h2 class="modal-title" id="modal-title">正在打开主页</h2>
            <p class="modal-text">用户资料、公开博客和共享计划正在加载中。</p>
          ` : space && user ? `
            <div class="user-space-head">
              <div class="user-space-identity">
                ${renderAvatar(user, "avatar-large")}
                <div>
                  <h2 class="modal-title" id="modal-title">${escapeHtml(user.name || "未命名用户")}</h2>
                  <p class="modal-text no-margin">${escapeHtml(getLocationSummary(user.profile && user.profile.location))}</p>
                </div>
              </div>
              <div class="user-space-actions">
                ${renderUserSpaceActions(space)}
              </div>
            </div>
            <div class="profile-summary-row">
              <span class="portal-chip"><strong>性别:</strong> ${escapeHtml(getReadableGender(user.profile && user.profile.gender))}</span>
              <span class="portal-chip"><strong>地区:</strong> ${escapeHtml(getLocationSummary(user.profile && user.profile.location))}</span>
              <span class="portal-chip"><strong>介绍:</strong> ${escapeHtml(getReadableBio(user.profile && user.profile.bio))}</span>
            </div>
            <div class="user-space-grid">
              <section class="card-block">
                <div class="feed-toolbar">
                  <h3 class="section-title no-margin">公开博客</h3>
                  <span class="feed-count">${escapeHtml(String((space.blogs || []).length))} 篇</span>
                </div>
                ${(space.blogs || []).length ? `
                  <div class="feed-list user-space-feed">
                    ${(space.blogs || []).map((blog) => renderUserSpaceBlogCard(blog)).join("")}
                  </div>
                ` : renderEmptyState("还没有公开博客", "对方发布公开博客后，这里会显示出来。")}
              </section>
              <section class="card-block">
                <div class="feed-toolbar">
                  <h3 class="section-title no-margin">共享计划</h3>
                  <span class="feed-count">${escapeHtml(String((space.checkins || []).length))} 项</span>
                </div>
                ${(space.checkins || []).length ? `
                  <div class="checkin-list">
                    ${(space.checkins || []).map((item) => renderUserSpaceCheckinCard(item)).join("")}
                  </div>
                ` : renderEmptyState(
                  canSeeSharedCheckins ? "还没有共享计划" : "计划仅好友可见",
                  canSeeSharedCheckins
                    ? "对方把打卡项设为好友可见后，这里就会出现。"
                    : "互相加为好友后，你才能看到对方共享的打卡计划。"
                )}
              </section>
            </div>
          ` : `
            <h2 class="modal-title" id="modal-title">没有找到主页</h2>
            <p class="modal-text">${escapeHtml(modal.error || "这个用户可能不存在。")}</p>
          `}
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-action="dismissModal">关闭</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderUserSpaceActions(space) {
    if (!space || !space.user) {
      return "";
    }

    if (space.isSelf) {
      return `
        <span class="visibility-badge">这是你的主页</span>
        <button class="btn btn-secondary btn-small" type="button" data-action="openProfile">编辑资料</button>
      `;
    }

    const friendship = space.friendship && typeof space.friendship === "object" ? space.friendship : { status: "none" };
    const userId = space.user.id || "";

    if (friendship.status === "friends") {
      return `
        <span class="visibility-badge">已是好友</span>
        <button
          class="btn btn-primary btn-small"
          type="button"
          data-action="openChat"
          data-user-id="${escapeHtml(userId)}"
        >
          发消息
        </button>
      `;
    }

    if (friendship.status === "incoming") {
      return `
        <span class="visibility-badge">对方向你发来了好友申请</span>
        <button
          class="btn btn-primary btn-small"
          type="button"
          data-action="acceptFriendRequest"
          data-request-id="${escapeHtml(friendship.requestId || "")}"
        >
          同意
        </button>
        <button
          class="btn btn-secondary btn-small"
          type="button"
          data-action="rejectFriendRequest"
          data-request-id="${escapeHtml(friendship.requestId || "")}"
        >
          拒绝
        </button>
      `;
    }

    if (friendship.status === "outgoing") {
      return `<span class="visibility-badge">好友申请已发送</span>`;
    }

    return `
      <span class="visibility-badge">陌生人</span>
      <button
        class="btn btn-primary btn-small"
        type="button"
        data-action="sendFriendRequest"
        data-user-id="${escapeHtml(userId)}"
      >
        加好友
      </button>
    `;
  }

  function renderChatModule() {
    const activeConversation = getActiveConversation();
    const activeUser = activeConversation && activeConversation.user ? activeConversation.user : null;

    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Chat</p>
          <h2 class="module-title">聊天</h2>
          <p class="section-desc">只有互为好友后才能聊天。点赞、评论、好友申请和新消息都会在左侧提醒区域同步刷新。</p>
        </header>
        <div class="module-grid chat-grid">
          <section class="card-block module-card">
            <div class="feed-toolbar">
              <h3 class="section-title no-margin">好友会话</h3>
              <span class="feed-count">${escapeHtml(String(state.conversations.length))} 位</span>
            </div>
            ${state.conversations.length ? `
              <div class="conversation-list">
                ${state.conversations.map((conversation) => renderConversationCard(conversation)).join("")}
              </div>
            ` : renderEmptyState("还没有可聊天的好友", "去社区或其他人的主页发起好友申请，对方同意后这里就会出现聊天入口。")}
          </section>
          <section class="card-block module-card chat-thread-card">
            ${activeUser ? `
              <div class="chat-thread-head">
                <div class="user-space-identity">
                  ${renderAvatar(activeUser, "avatar-large")}
                  <div>
                    <h3 class="section-title no-margin">${escapeHtml(activeUser.name || "未命名好友")}</h3>
                    <p class="section-desc no-margin">
                      ${activeConversation && activeConversation.unreadCount ? "未读 " + escapeHtml(String(activeConversation.unreadCount)) + " 条" : "聊天内容会按时间顺序显示"}
                    </p>
                  </div>
                </div>
                <div class="form-actions">
                  <button
                    class="btn btn-secondary btn-small"
                    type="button"
                    data-action="openUserSpace"
                    data-user-id="${escapeHtml(activeUser.id || "")}"
                  >
                    查看主页
                  </button>
                </div>
              </div>
              ${state.chatLoading ? `
                <div class="empty-box compact-empty">
                  <p>聊天记录加载中，请稍等。</p>
                </div>
              ` : state.chatMessages.length ? `
                <div class="chat-message-list">
                  ${state.chatMessages.map((message) => renderChatMessage(message)).join("")}
                </div>
              ` : `
                <div class="empty-box compact-empty">
                  <p>还没有聊天记录，先发第一条消息吧。</p>
                </div>
              `}
              <form class="form chat-form" data-form="chat">
                <div class="field">
                  <label for="chat-message">发送消息</label>
                  <textarea
                    id="chat-message"
                    name="chatMessage"
                    rows="4"
                    maxlength="2000"
                    placeholder="输入想说的话。"
                  >${escapeHtml(state.chatDraft.content)}</textarea>
                </div>
                <div class="form-actions">
                  <button class="btn btn-primary" type="submit" ${state.chatSubmitting ? "disabled" : ""}>
                    ${state.chatSubmitting ? "发送中..." : "发送消息"}
                  </button>
                </div>
              </form>
            ` : renderEmptyState("先选择一个好友", "左侧列出了你当前已经可以聊天的好友，点一个就能打开对话。")}
          </section>
        </div>
      </section>
    `;
  }

  function renderConversationCard(conversation) {
    const user = conversation && conversation.user ? conversation.user : null;
    const userId = user && user.id ? user.id : "";
    const isActive = Boolean(userId && userId === state.activeChatUserId);
    const lastMessage = conversation && conversation.lastMessage ? conversation.lastMessage : null;
    const preview = lastMessage && lastMessage.content ? lastMessage.content : "还没有聊天记录";

    return `
      <button
        class="conversation-card ${isActive ? "active" : ""}"
        type="button"
        data-action="selectChatUser"
        data-user-id="${escapeHtml(userId)}"
      >
        ${renderAvatar(user || { name: "好友" }, "avatar")}
        <div class="conversation-copy">
          <div class="conversation-meta">
            <strong>${escapeHtml((user && user.name) || "未命名好友")}</strong>
            <span>${escapeHtml(lastMessage ? formatDateTime(lastMessage.createdAt) : "等待开始聊天")}</span>
          </div>
          <p>${escapeHtml(preview)}</p>
        </div>
        ${conversation && conversation.unreadCount ? `<span class="module-badge">${escapeHtml(String(Math.min(conversation.unreadCount, 99)))}</span>` : ""}
      </button>
    `;
  }

  function renderChatMessage(message) {
    const author = message.mine ? state.currentUser : message.fromUser;

    return `
      <article class="chat-bubble ${message.mine ? "mine" : "other"}">
        <div class="chat-bubble-meta">
          ${renderAvatar(author || { name: message.mine ? "我" : "好友" }, "avatar")}
          <div>
            <strong>${escapeHtml((author && author.name) || (message.mine ? "我" : "好友"))}</strong>
            <span>${escapeHtml(formatDateTime(message.createdAt))}</span>
          </div>
        </div>
        <p>${escapeHtml(message.content || "")}</p>
      </article>
    `;
  }

  function renderCheckinModule() {
    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Check-In</p>
          <h2 class="module-title">打卡计划</h2>
          <p class="section-desc">你可以自由添加打卡项和打卡频率，查看每一项的完成情况，也可以查看别人的公开计划并发送提醒。</p>
        </header>
        <div class="module-grid checkin-grid">
          <section class="card-block module-card">
            <h3 class="section-title">创建新的打卡项</h3>
            <form class="form" data-form="checkin">
              <div class="field">
                <label for="checkin-title">打卡项名称</label>
                <input
                  id="checkin-title"
                  name="checkinTitle"
                  type="text"
                  maxlength="60"
                  placeholder="例如：晨跑 30 分钟"
                  value="${escapeHtml(state.checkinDraft.title)}"
                />
              </div>
              <div class="field">
                <label for="checkin-frequency">打卡频率</label>
                <input
                  id="checkin-frequency"
                  name="checkinFrequency"
                  type="text"
                  maxlength="40"
                  placeholder="例如：每天 / 每周三次 / 每周一到周五"
                  value="${escapeHtml(state.checkinDraft.frequency)}"
                />
              </div>
              ${renderSelectField({
                id: "checkin-visibility",
                name: "checkinVisibility",
                label: "别人是否可见",
                value: state.checkinDraft.visibility,
                placeholder: "请选择可见范围",
                options: CHECKIN_VISIBILITY_OPTIONS
              })}
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">添加打卡项</button>
              </div>
            </form>
          </section>
          <section class="card-block module-card">
            <div class="feed-toolbar">
              <h3 class="section-title no-margin">我的打卡项</h3>
              <span class="feed-count">${escapeHtml(String(state.checkins.mine.length))} 项</span>
            </div>
            ${state.checkins.mine.length ? `
              <div class="checkin-list">
                ${state.checkins.mine.map((item) => renderCheckinCard(item, "mine")).join("")}
              </div>
            ` : renderEmptyState("还没有自己的打卡项", "先在左侧创建一个，创建完成后这里会出现完成入口和历史查看入口。")}
          </section>
          <section class="card-block module-card">
            <div class="feed-toolbar">
              <h3 class="section-title no-margin">查看别人计划</h3>
              <span class="feed-count">${escapeHtml(String(state.checkins.community.length))} 项</span>
            </div>
            ${state.checkins.community.length ? `
              <div class="checkin-list">
                ${state.checkins.community.map((item) => renderCheckinCard(item, "community")).join("")}
              </div>
            ` : renderEmptyState("暂时没有公开的计划", "只有别人把打卡项设置为可见后，这里才会出现。")}
          </section>
        </div>
      </section>
    `;
  }

  function renderCheckinCard(item, context) {
    const ownerName = item.owner && item.owner.name ? item.owner.name : "匿名用户";
    const ownerId = item.owner && item.owner.id ? item.owner.id : "";
    const visibilityText = item.visibility === "public" ? "别人可见" : "仅自己可见";

    return `
      <article class="checkin-card">
        <div class="checkin-card-top">
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.frequency)}</p>
          </div>
          <span class="status-badge ${item.completedToday ? "done" : "pending"}">
            ${escapeHtml(item.completedToday ? "今日已完成" : "今日未完成")}
          </span>
        </div>
        <div class="badge-row">
          ${context === "mine" ? `<span class="visibility-badge">${escapeHtml(visibilityText)}</span>` : `<span class="visibility-badge">${escapeHtml(ownerName)}</span>`}
          <span class="visibility-badge">累计 ${escapeHtml(String(item.completionCount))} 次</span>
        </div>
        <div class="form-actions">
          ${context === "mine"
            ? `
              <button
                class="btn btn-primary"
                type="button"
                data-action="completeCheckin"
                data-item-id="${escapeHtml(item.id)}"
                ${item.completedToday ? "disabled" : ""}
              >
                ${item.completedToday ? "今天已经完成" : "完成今天打卡"}
              </button>
            `
            : `
              <button
                class="btn btn-secondary"
                type="button"
                data-action="openReminderModal"
                data-item-id="${escapeHtml(item.id)}"
                ${item.completedToday ? "disabled" : ""}
              >
                ${item.completedToday ? "对方已完成" : "提醒对方"}
              </button>
              ${ownerId ? `
                <button
                  class="btn btn-secondary"
                  type="button"
                  data-action="openUserSpace"
                  data-user-id="${escapeHtml(ownerId)}"
                >
                  查看主页
                </button>
              ` : ""}
            `}
          <button
            class="btn btn-secondary"
            type="button"
            data-action="openCheckinHistory"
            data-item-id="${escapeHtml(item.id)}"
          >
            查看完成情况
          </button>
        </div>
      </article>
    `;
  }

  function renderTimerModule() {
    const duration = getTimerDurationSeconds(state.timer.mode);
    const progress = Math.max(0, Math.min(100, ((duration - state.timer.remainingSeconds) / duration) * 100));

    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Timer</p>
          <h2 class="module-title">番茄钟</h2>
          <p class="section-desc">这里是内置计时器。专注和休息时间都可以手动调整，完成一个专注周期后会自动切到休息时间。</p>
        </header>
        <div class="module-grid timer-grid">
          <section class="card-block module-card timer-main-card">
            <div class="timer-mode-row">
              <button
                class="segment ${state.timer.mode === "focus" ? "active" : ""}"
                type="button"
                data-action="switchTimerMode"
                data-mode="focus"
              >
                专注
              </button>
              <button
                class="segment ${state.timer.mode === "break" ? "active" : ""}"
                type="button"
                data-action="switchTimerMode"
                data-mode="break"
              >
                休息
              </button>
            </div>
            <div class="timer-display">${escapeHtml(formatDuration(state.timer.remainingSeconds))}</div>
            <div class="timer-progress">
              <span class="timer-progress-bar" style="width: ${escapeHtml(progress.toFixed(2))}%"></span>
            </div>
            <div class="timer-stat-grid">
              <div class="timer-stat">
                <span>当前模式</span>
                <strong>${escapeHtml(state.timer.mode === "focus" ? "专注中" : "休息中")}</strong>
              </div>
              <div class="timer-stat">
                <span>完成番茄数</span>
                <strong>${escapeHtml(String(state.timer.completedFocusCount))}</strong>
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="button" data-action="${state.timer.isRunning ? "pauseTimer" : "startTimer"}">
                ${escapeHtml(state.timer.isRunning ? "暂停" : "开始")}
              </button>
              <button class="btn btn-secondary" type="button" data-action="resetTimer">重置</button>
            </div>
          </section>
          <section class="card-block module-card">
            <h3 class="section-title">时间设置</h3>
            <div class="form">
              <div class="field">
                <label for="timer-focus-minutes">专注时长（分钟）</label>
                <input
                  id="timer-focus-minutes"
                  name="timerFocusMinutes"
                  type="number"
                  min="1"
                  max="120"
                  value="${escapeHtml(String(state.timer.focusMinutes))}"
                />
              </div>
              <div class="field">
                <label for="timer-break-minutes">休息时长（分钟）</label>
                <input
                  id="timer-break-minutes"
                  name="timerBreakMinutes"
                  type="number"
                  min="1"
                  max="120"
                  value="${escapeHtml(String(state.timer.breakMinutes))}"
                />
              </div>
              <div class="timer-preset-row">
                <button class="btn btn-secondary" type="button" data-action="applyTimerPreset" data-focus="25" data-break="5">经典 25/5</button>
                <button class="btn btn-secondary" type="button" data-action="applyTimerPreset" data-focus="50" data-break="10">深度 50/10</button>
              </div>
              <p class="field-hint">修改时间后，当前模式在未运行时会立即跟着更新时间。</p>
            </div>
          </section>
        </div>
      </section>
    `;
  }

  function renderProfileModule(currentUser) {
    const options = getRegionOptions();

    return `
      <section class="module-shell">
        <header class="module-head">
          <p class="eyebrow">Profile</p>
          <h2 class="module-title">个人资料</h2>
          <p class="section-desc">这里保存的是会跟随账号同步的资料。国家列表来自公开国家代码数据，中国省市县联动基于公开行政区划数据。</p>
        </header>
        <div class="profile-summary-row">
          <span class="portal-chip"><strong>性别:</strong> ${escapeHtml(getReadableGender(currentUser.profile && currentUser.profile.gender))}</span>
          <span class="portal-chip"><strong>地区:</strong> ${escapeHtml(getLocationSummary(currentUser.profile && currentUser.profile.location))}</span>
          <span class="portal-chip"><strong>介绍:</strong> ${escapeHtml(getReadableBio(currentUser.profile && currentUser.profile.bio))}</span>
        </div>
        <form class="form profile-form" data-form="profile">
          ${renderProfileAvatarField(currentUser)}
          ${renderSelectField({
            id: "profile-gender",
            name: "profileGender",
            label: "性别",
            value: state.profileDraft.gender,
            placeholder: "请选择性别",
            options: GENDER_OPTIONS.map((item) => ({ value: item, label: item }))
          })}
          <div class="field field-span-2">
            <label for="profile-bio">个人介绍</label>
            <textarea
              id="profile-bio"
              name="profileBio"
              maxlength="240"
              rows="5"
              placeholder="写一段关于你的介绍，例如你关注什么、正在做什么。"
            >${escapeHtml(state.profileDraft.bio)}</textarea>
            <p class="field-hint">最多 240 个字，会跟随账号同步到其他设备。</p>
          </div>
          <div class="profile-region-grid field-span-2">
            ${renderSelectField({
              id: "profile-country",
              name: "profileCountry",
              label: "国家",
              value: state.profileDraft.location.countryCode,
              placeholder: "请选择国家",
              options: options.countryOptions.map((item) => ({
                value: item.code,
                label: item.name + (item.englishName ? " / " + item.englishName : "")
              }))
            })}
            ${renderSelectField({
              id: "profile-province",
              name: "profileProvince",
              label: "省份",
              value: state.profileDraft.location.provinceCode,
              placeholder: options.isChina ? "请选择省份" : "先选择中国",
              options: options.provinceOptions.map((item) => ({ value: item.code, label: item.name })),
              disabled: !options.isChina
            })}
            ${renderSelectField({
              id: "profile-city",
              name: "profileCity",
              label: "市",
              value: state.profileDraft.location.cityCode,
              placeholder: options.isChina ? "请选择市" : "先选择中国",
              options: options.cityOptions.map((item) => ({ value: item.code, label: item.name })),
              disabled: !options.isChina || !state.profileDraft.location.provinceCode
            })}
            ${renderSelectField({
              id: "profile-county",
              name: "profileCounty",
              label: "县",
              value: state.profileDraft.location.countyCode,
              placeholder: options.isChina ? "请选择县" : "先选择中国",
              options: options.countyOptions.map((item) => ({ value: item.code, label: item.name })),
              disabled: !options.isChina || !state.profileDraft.location.cityCode
            })}
          </div>
          ${options.isChina ? `
            <p class="field-hint field-span-2">国家选中国时，会继续显示国家 / 省份 / 市 / 县四级联动。</p>
          ` : `
            <p class="field-hint field-span-2">当前只为中国提供省、市、县联动数据；选择其他国家时会先保存国家。</p>
          `}
          <div class="form-actions profile-form-actions field-span-2">
            <button class="btn btn-primary" type="submit" ${state.profileSaving || state.profileAvatarProcessing ? "disabled" : ""}>
              ${state.profileSaving ? "保存中..." : state.profileAvatarProcessing ? "头像处理中..." : "保存资料"}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  function renderSelectField(options) {
    return `
      <div class="field">
        <label for="${escapeHtml(options.id)}">${escapeHtml(options.label)}</label>
        <div class="select-wrap">
          <select
            id="${escapeHtml(options.id)}"
            name="${escapeHtml(options.name)}"
            ${options.disabled ? "disabled" : ""}
          >
            <option value="">${escapeHtml(options.placeholder || "请选择")}</option>
            ${(options.options || [])
              .map((item) => {
                const selected = item.value === options.value ? "selected" : "";
                return `<option value="${escapeHtml(item.value)}" ${selected}>${escapeHtml(item.label)}</option>`;
              })
              .join("")}
          </select>
        </div>
      </div>
    `;
  }

  function renderToast() {
    if (!state.toast || !state.toast.text) {
      return "";
    }

    return `
      <div class="toast ${escapeHtml(state.toast.type || "info")}" role="status" aria-live="polite">
        <p>${escapeHtml(state.toast.text)}</p>
        <button class="toast-close" type="button" data-action="dismissToast" aria-label="关闭提示">×</button>
      </div>
    `;
  }

  function renderModal() {
    if (!state.modal) {
      return "";
    }

    if (state.modal.kind === "alert") {
      return `
        <div class="modal-backdrop" role="presentation">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p class="modal-eyebrow modal-eyebrow-danger">错误提示</p>
            <h2 class="modal-title" id="modal-title">${escapeHtml(state.modal.title)}</h2>
            <p class="modal-text">${escapeHtml(state.modal.text)}</p>
            <div class="modal-actions">
              <button class="btn btn-danger" type="button" data-action="dismissModal">${escapeHtml(state.modal.confirmLabel || "知道了")}</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.modal.kind === "confirm") {
      return `
        <div class="modal-backdrop" role="presentation">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p class="modal-eyebrow">操作确认</p>
            <h2 class="modal-title" id="modal-title">${escapeHtml(state.modal.title)}</h2>
            <p class="modal-text">${escapeHtml(state.modal.text)}</p>
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-action="dismissModal">取消</button>
              <button class="btn btn-primary" type="button" data-action="confirmModal">${escapeHtml(state.modal.confirmLabel)}</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.modal.kind === "deleteUser") {
      return `
        <div class="modal-backdrop" role="presentation">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p class="modal-eyebrow modal-eyebrow-danger">删除验证</p>
            <h2 class="modal-title" id="modal-title">${escapeHtml(state.modal.title)}</h2>
            <p class="modal-text">${escapeHtml(state.modal.text)}</p>
            <div class="modal-field">
              <label for="modal-password">当前账户密码</label>
              <div class="password-input-wrap">
                <input
                  id="modal-password"
                  name="modalPassword"
                  type="${state.passwordVisibility.modalDelete ? "text" : "password"}"
                  autocomplete="current-password"
                  placeholder="输入当前账户密码"
                  value="${escapeHtml(state.modal.password || "")}"
                />
                <button
                  class="password-toggle ${state.passwordVisibility.modalDelete ? "is-active" : ""}"
                  type="button"
                  data-action="togglePassword"
                  data-field="modalDelete"
                  aria-label="${state.passwordVisibility.modalDelete ? "隐藏密码" : "显示密码"}"
                  title="${state.passwordVisibility.modalDelete ? "隐藏密码" : "显示密码"}"
                >
                  ${renderEyeIcon(state.passwordVisibility.modalDelete)}
                </button>
              </div>
              ${state.modal.error ? `<p class="field-hint error">${escapeHtml(state.modal.error)}</p>` : ""}
            </div>
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-action="dismissModal">取消</button>
              <button class="btn btn-danger" type="button" data-action="confirmModal">${escapeHtml(state.modal.confirmLabel)}</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.modal.kind === "checkinHistory") {
      const item = findStateCheckinItem(state.modal.itemId);
      const history = item && Array.isArray(item.recentCompletions) ? item.recentCompletions : [];

      return `
        <div class="modal-backdrop" role="presentation">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p class="modal-eyebrow">完成情况</p>
            <h2 class="modal-title" id="modal-title">${escapeHtml(item ? item.title : "打卡记录")}</h2>
            <p class="modal-text">${escapeHtml(item ? item.frequency : "")}</p>
            ${history.length ? `
              <div class="history-list">
                ${history
                  .map((entry) => `
                    <div class="history-item">
                      <strong>${escapeHtml(entry.date)}</strong>
                      <span>${escapeHtml(formatDateTime(entry.completedAt))}</span>
                    </div>
                  `)
                  .join("")}
              </div>
            ` : `<p class="field-hint">还没有完成记录。</p>`}
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-action="dismissModal">关闭</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.modal.kind === "checkinReminder") {
      const item = findStateCheckinItem(state.modal.itemId);
      const ownerName = item && item.owner && item.owner.name ? item.owner.name : "对方";

      return `
        <div class="modal-backdrop" role="presentation">
          <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p class="modal-eyebrow">发送提醒</p>
            <h2 class="modal-title" id="modal-title">提醒 ${escapeHtml(ownerName)}</h2>
            <p class="modal-text">你可以留一句话，对方下次上线时会在提醒面板看到。</p>
            <div class="modal-field">
              <label for="reminder-message">提醒留言</label>
              <input
                id="reminder-message"
                name="reminderMessage"
                type="text"
                maxlength="240"
                autocomplete="off"
                placeholder="例如：今天别忘了完成这项计划。"
                value="${escapeHtml(state.modal.message || "")}"
              />
              ${state.modal.error ? `<p class="field-hint error">${escapeHtml(state.modal.error)}</p>` : ""}
            </div>
            <div class="modal-actions">
              <button class="btn btn-secondary" type="button" data-action="dismissModal">取消</button>
              <button class="btn btn-primary" type="button" data-action="confirmModal">发送提醒</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.modal.kind === "publishBlog") {
      return renderPublishBlogModal();
    }

    if (state.modal.kind === "blogDetail") {
      return renderBlogDetailModal(state.modal);
    }

    if (state.modal.kind === "userSpace") {
      return renderUserSpaceModal(state.modal);
    }

    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <p class="modal-eyebrow">找回密码</p>
          <h2 class="modal-title" id="modal-title">${escapeHtml(state.modal.title)}</h2>
          <p class="modal-text">正在为 ${escapeHtml(state.modal.userName || "")} 校验密保问题，回答正确后可以直接重置密码。</p>
          ${state.modal.loading ? `
            <p class="field-hint">正在加载密保问题...</p>
          ` : `
            <div class="modal-field">
              <label>密保问题</label>
              <p class="field-hint">${escapeHtml(state.modal.question || "")}</p>
            </div>
            <div class="modal-field">
              <label for="recovery-answer">密保答案</label>
              <input
                id="recovery-answer"
                name="recoveryAnswer"
                type="text"
                autocomplete="off"
                placeholder="输入密保答案"
                value="${escapeHtml(state.modal.answer || "")}"
              />
            </div>
            <div class="modal-field">
              <label for="recovery-new-password">新密码</label>
              <div class="password-input-wrap">
                <input
                  id="recovery-new-password"
                  name="recoveryNewPassword"
                  type="${state.passwordVisibility.modalRecovery ? "text" : "password"}"
                  autocomplete="new-password"
                  placeholder="输入新密码"
                  value="${escapeHtml(state.modal.newPassword || "")}"
                />
                <button
                  class="password-toggle ${state.passwordVisibility.modalRecovery ? "is-active" : ""}"
                  type="button"
                  data-action="togglePassword"
                  data-field="modalRecovery"
                  aria-label="${state.passwordVisibility.modalRecovery ? "隐藏密码" : "显示密码"}"
                  title="${state.passwordVisibility.modalRecovery ? "隐藏密码" : "显示密码"}"
                >
                  ${renderEyeIcon(state.passwordVisibility.modalRecovery)}
                </button>
              </div>
            </div>
            <div class="modal-field">
              <label for="recovery-confirm-password">确认新密码</label>
              <div class="password-input-wrap">
                <input
                  id="recovery-confirm-password"
                  name="recoveryConfirmPassword"
                  type="${state.passwordVisibility.modalRecoveryConfirm ? "text" : "password"}"
                  autocomplete="new-password"
                  placeholder="再次输入新密码"
                  value="${escapeHtml(state.modal.confirmPassword || "")}"
                />
                <button
                  class="password-toggle ${state.passwordVisibility.modalRecoveryConfirm ? "is-active" : ""}"
                  type="button"
                  data-action="togglePassword"
                  data-field="modalRecoveryConfirm"
                  aria-label="${state.passwordVisibility.modalRecoveryConfirm ? "隐藏密码" : "显示密码"}"
                  title="${state.passwordVisibility.modalRecoveryConfirm ? "隐藏密码" : "显示密码"}"
                >
                  ${renderEyeIcon(state.passwordVisibility.modalRecoveryConfirm)}
                </button>
              </div>
              <p class="field-hint">${escapeHtml(PASSWORD_RULE_TEXT)}</p>
            </div>
            ${state.modal.error ? `<p class="field-hint error">${escapeHtml(state.modal.error)}</p>` : ""}
          `}
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" data-action="dismissModal">取消</button>
            <button class="btn btn-primary" type="button" data-action="confirmModal" ${state.modal.loading ? "disabled" : ""}>重置密码</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderPasswordField(options) {
    const visible = Boolean(state.passwordVisibility[options.visibilityKey]);
    const hintClass = options.hintTone ? "field-hint " + options.hintTone : "field-hint";

    return `
      <div class="field">
        <label for="${escapeHtml(options.id)}">${escapeHtml(options.label)}</label>
        <div class="password-input-wrap">
          <input
            id="${escapeHtml(options.id)}"
            name="${escapeHtml(options.name)}"
            type="${visible ? "text" : "password"}"
            autocomplete="${escapeHtml(options.autocomplete || "off")}"
            placeholder="${escapeHtml(options.placeholder || "")}"
            value="${escapeHtml(options.value || "")}"
          />
          <button
            class="password-toggle ${visible ? "is-active" : ""}"
            type="button"
            data-action="togglePassword"
            data-field="${escapeHtml(options.visibilityKey)}"
            aria-label="${visible ? "隐藏密码" : "显示密码"}"
            title="${visible ? "隐藏密码" : "显示密码"}"
          >
            ${renderEyeIcon(visible)}
          </button>
        </div>
        ${options.hint ? `<p class="${hintClass}">${escapeHtml(options.hint)}</p>` : ""}
      </div>
    `;
  }

  function renderEyeIcon(visible) {
    if (visible) {
      return `
        <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        </svg>
      `;
    }

    return `
      <svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1.5 12s3.8-6 10.5-6c2.2 0 4.1.6 5.7 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M22.5 12s-3.8 6-10.5 6c-2.2 0-4.1-.6-5.7-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>
    `;
  }

  // ---------------------------------------------------------------------------
  // UI state helpers
  // ---------------------------------------------------------------------------

  function flash(text, type, options) {
    if (type === "error") {
      state.toast = null;
      state.modal = {
        kind: "alert",
        title: (options && options.title) || "请检查输入",
        text,
        confirmLabel: "知道了"
      };
      return;
    }

    state.toast = {
      type: type || "info",
      text
    };
  }

  function clearToast() {
    state.toast = null;
  }

  function closeModal() {
    state.modal = null;
    resetPasswordVisibility();
    render();
  }

  function resetPasswordVisibility() {
    state.passwordVisibility.login = false;
    state.passwordVisibility.register = false;
    state.passwordVisibility.registerConfirm = false;
    state.passwordVisibility.modalDelete = false;
    state.passwordVisibility.modalRecovery = false;
    state.passwordVisibility.modalRecoveryConfirm = false;
  }

  function resetRegisterValidation() {
    state.registerValidation.password.touched = false;
    state.registerValidation.password.status = "";
    state.registerValidation.password.message = "";
    state.registerValidation.confirm.touched = false;
    state.registerValidation.confirm.status = "";
    state.registerValidation.confirm.message = "";
  }

  function validateRegisterPassword(markTouched) {
    if (markTouched) {
      state.registerValidation.password.touched = true;
    }

    if (!state.registerValidation.password.touched) {
      return isValidPassword(state.registerDraft.password);
    }

    if (!state.registerDraft.password) {
      state.registerValidation.password.status = "error";
      state.registerValidation.password.message = "请输入密码。";
      return false;
    }

    if (!isValidPassword(state.registerDraft.password)) {
      state.registerValidation.password.status = "error";
      state.registerValidation.password.message = PASSWORD_RULE_TEXT;
      return false;
    }

    state.registerValidation.password.status = "success";
    state.registerValidation.password.message = "密码格式正确。";
    return true;
  }

  function validateRegisterConfirm(markTouched) {
    if (markTouched) {
      state.registerValidation.confirm.touched = true;
    }

    if (!state.registerValidation.confirm.touched) {
      return (
        state.registerDraft.confirmPassword === state.registerDraft.password &&
        Boolean(state.registerDraft.confirmPassword)
      );
    }

    if (!state.registerDraft.confirmPassword) {
      state.registerValidation.confirm.status = "error";
      state.registerValidation.confirm.message = "请再次输入确认密码。";
      return false;
    }

    if (!state.registerDraft.password) {
      state.registerValidation.confirm.status = "error";
      state.registerValidation.confirm.message = "请先输入上面的密码。";
      return false;
    }

    if (state.registerDraft.confirmPassword !== state.registerDraft.password) {
      state.registerValidation.confirm.status = "error";
      state.registerValidation.confirm.message = "两次输入的密码不一致。";
      return false;
    }

    if (!isValidPassword(state.registerDraft.password)) {
      state.registerValidation.confirm.status = "error";
      state.registerValidation.confirm.message = "请先把上面的密码改正确。";
      return false;
    }

    state.registerValidation.confirm.status = "success";
    state.registerValidation.confirm.message = "两次密码输入一致。";
    return true;
  }

  function getPasswordHint() {
    if (state.registerValidation.password.touched) {
      return {
        message: state.registerValidation.password.message,
        tone: state.registerValidation.password.status
      };
    }

    return {
      message: PASSWORD_RULE_TEXT,
      tone: ""
    };
  }

  function getConfirmHint() {
    if (state.registerValidation.confirm.touched) {
      return {
        message: state.registerValidation.confirm.message,
        tone: state.registerValidation.confirm.status
      };
    }

    return {
      message: "再次输入一次相同密码。",
      tone: ""
    };
  }

  function syncBlogPreview() {
    const previewTitle = document.getElementById("blog-preview-title");
    const previewContent = document.getElementById("blog-preview");

    if (previewTitle) {
      previewTitle.textContent = state.blogDraft.title.trim() || "还没有标题";
    }

    if (previewContent) {
      previewContent.innerHTML = renderMarkdown(state.blogDraft.content);
    }
  }

  function getUnreadNotificationsCount() {
    return state.notifications.filter((item) => !item.readAt).length;
  }

  function getUnreadConversationCount() {
    return state.conversations.reduce((total, item) => total + Number(item.unreadCount || 0), 0);
  }

  function getModuleBadgeCount(moduleKey) {
    if (moduleKey === "blog") {
      return getUnreadNotificationsCount();
    }

    if (moduleKey === "chat") {
      return getUnreadConversationCount();
    }

    return 0;
  }

  function getActiveConversation() {
    return state.conversations.find((item) => item.user && item.user.id === state.activeChatUserId) || null;
  }

  // ---------------------------------------------------------------------------
  // Data normalization
  // ---------------------------------------------------------------------------

  function normalizeCountries(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    const seen = new Set();
    const countries = list
      .map((item) => {
        const code = typeof item.alpha2 === "string" ? item.alpha2.trim().toUpperCase() : "";
        const name = typeof item.cnname === "string" ? item.cnname.trim() : "";
        const englishName = typeof item.name === "string" ? item.name.trim() : "";

        if (!code || !name || seen.has(code)) {
          return null;
        }

        seen.add(code);
        return {
          code,
          name,
          englishName
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

    const chinaIndex = countries.findIndex((item) => item.code === "CN");
    if (chinaIndex > 0) {
      const china = countries.splice(chinaIndex, 1)[0];
      countries.unshift(china);
    }

    return countries;
  }

  function normalizeChinaRegions(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .map((province) => {
        const provinceChildren = Array.isArray(province.children) ? province.children : [];
        const hasNestedCities = provinceChildren.some((item) => Array.isArray(item.children));
        const cities = hasNestedCities
          ? provinceChildren.map((city) => ({
              code: String(city.code || ""),
              name: String(city.name || ""),
              counties: normalizeCounties(city.children)
            }))
          : [
              {
                code: String(province.code || ""),
                name: String(province.name || ""),
                counties: normalizeCounties(provinceChildren)
              }
            ];

        return {
          code: String(province.code || ""),
          name: String(province.name || ""),
          cities
        };
      })
      .filter((province) => province.code && province.name);
  }

  function normalizeCounties(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list
      .filter((item) => item && item.name && item.name !== "市辖区")
      .map((item) => ({
        code: String(item.code || ""),
        name: String(item.name || "")
      }));
  }

  function createProfileDraft(user) {
    const profile = user && user.profile && typeof user.profile === "object" ? user.profile : {};
    const location = profile.location && typeof profile.location === "object" ? profile.location : {};

    return {
      avatar: getSafeAvatar(user && user.avatar),
      gender: typeof profile.gender === "string" ? profile.gender : "",
      bio: typeof profile.bio === "string" ? profile.bio : "",
      location: {
        countryCode: typeof location.countryCode === "string" ? location.countryCode : "",
        countryName: typeof location.countryName === "string" ? location.countryName : "",
        provinceCode: typeof location.provinceCode === "string" ? location.provinceCode : "",
        provinceName: typeof location.provinceName === "string" ? location.provinceName : "",
        cityCode: typeof location.cityCode === "string" ? location.cityCode : "",
        cityName: typeof location.cityName === "string" ? location.cityName : "",
        countyCode: typeof location.countyCode === "string" ? location.countyCode : "",
        countyName: typeof location.countyName === "string" ? location.countyName : ""
      }
    };
  }

  function getSelectedProvince() {
    return state.regionData.china.find((item) => item.code === state.profileDraft.location.provinceCode) || null;
  }

  function getSelectedCity() {
    const province = getSelectedProvince();
    if (!province) {
      return null;
    }

    return province.cities.find((item) => item.code === state.profileDraft.location.cityCode) || null;
  }

  function getRegionOptions() {
    const countryOptions = state.regionData.countries;
    const isChina = state.profileDraft.location.countryCode === "CN";
    const provinceOptions = isChina ? state.regionData.china : [];
    const selectedProvince = getSelectedProvince();
    const cityOptions = selectedProvince ? selectedProvince.cities : [];
    const selectedCity = getSelectedCity();
    const countyOptions = selectedCity ? selectedCity.counties : [];

    return {
      countryOptions,
      provinceOptions,
      cityOptions,
      countyOptions,
      isChina
    };
  }

  function updateProfileCountry(countryCode) {
    const country = state.regionData.countries.find((item) => item.code === countryCode) || null;
    state.profileDraft.location.countryCode = country ? country.code : "";
    state.profileDraft.location.countryName = country ? country.name : "";
    state.profileDraft.location.provinceCode = "";
    state.profileDraft.location.provinceName = "";
    state.profileDraft.location.cityCode = "";
    state.profileDraft.location.cityName = "";
    state.profileDraft.location.countyCode = "";
    state.profileDraft.location.countyName = "";
  }

  function updateProfileProvince(provinceCode) {
    const province = state.regionData.china.find((item) => item.code === provinceCode) || null;
    state.profileDraft.location.provinceCode = province ? province.code : "";
    state.profileDraft.location.provinceName = province ? province.name : "";
    state.profileDraft.location.cityCode = "";
    state.profileDraft.location.cityName = "";
    state.profileDraft.location.countyCode = "";
    state.profileDraft.location.countyName = "";
  }

  function updateProfileCity(cityCode) {
    const province = getSelectedProvince();
    const city = province ? province.cities.find((item) => item.code === cityCode) || null : null;
    state.profileDraft.location.cityCode = city ? city.code : "";
    state.profileDraft.location.cityName = city ? city.name : "";
    state.profileDraft.location.countyCode = "";
    state.profileDraft.location.countyName = "";
  }

  function updateProfileCounty(countyCode) {
    const city = getSelectedCity();
    const county = city ? city.counties.find((item) => item.code === countyCode) || null : null;
    state.profileDraft.location.countyCode = county ? county.code : "";
    state.profileDraft.location.countyName = county ? county.name : "";
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  function renderMarkdown(text) {
    const source = typeof text === "string" ? text.trim() : "";
    if (!source) {
      return `<p class="markdown-empty">还没有内容，写点东西就能在这里预览。</p>`;
    }

    const codeBlocks = [];
    const plain = source.replace(/```([\w-]+)?\n?([\s\S]*?)```/g, function (_, language, code) {
      const index = codeBlocks.push(renderMarkdownCodeBlock(code, language)) - 1;
      return "@@CODEBLOCK" + index + "@@";
    });

    const rendered = plain
      .split(/\n{2,}/)
      .map((block) => renderMarkdownBlock(block))
      .join("");

    return rendered.replace(/@@CODEBLOCK(\d+)@@/g, function (_, index) {
      return codeBlocks[Number(index)] || "";
    });
  }

  function renderMarkdownBlock(block) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      return "";
    }

    if (/^@@CODEBLOCK\d+@@$/.test(trimmedBlock)) {
      return trimmedBlock;
    }

    const headingMatch = trimmedBlock.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      return `<h${level}>${applyInlineMarkdown(escapeHtml(headingMatch[2]))}</h${level}>`;
    }

    if (/^([-*_]\s*){3,}$/.test(trimmedBlock)) {
      return `<hr>`;
    }

    const lines = trimmedBlock.split("\n").map((line) => line.replace(/\s+$/, ""));

    if (isMarkdownTable(lines)) {
      return renderMarkdownTable(lines);
    }

    if (lines.every((line) => /^[-*+]\s+/.test(line.trim()))) {
      return `<ul>${lines
        .map((line) => renderMarkdownListItem(line, false))
        .join("")}</ul>`;
    }

    if (lines.every((line) => /^\d+\.\s+/.test(line.trim()))) {
      return `<ol>${lines
        .map((line) => renderMarkdownListItem(line, true))
        .join("")}</ol>`;
    }

    if (lines.every((line) => /^>\s?/.test(line.trim()))) {
      return `<blockquote>${lines
        .map((line) => applyInlineMarkdown(escapeHtml(line.trim().replace(/^>\s?/, ""))))
        .join("<br>")}</blockquote>`;
    }

    return `<p>${lines.map((line) => applyInlineMarkdown(escapeHtml(line.trim()))).join("<br>")}</p>`;
  }

  function applyInlineMarkdown(text) {
    const inlineCode = [];
    let output = text.replace(/`([^`]+)`/g, function (_, code) {
      const index = inlineCode.push(`<code>${code}</code>`) - 1;
      return "@@INLINECODE" + index + "@@";
    });

    output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
      const safeUrl = getSafeMarkdownUrl(url);
      if (!safeUrl) {
        return alt || "图片";
      }
      return `<img src="${safeUrl}" alt="${alt}" loading="lazy">`;
    });
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      const safeUrl = getSafeMarkdownUrl(url);
      if (!safeUrl) {
        return label;
      }
      return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`;
    });
    output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    return output.replace(/@@INLINECODE(\d+)@@/g, function (_, index) {
      return inlineCode[Number(index)] || "";
    });
  }

  function renderMarkdownCodeBlock(code, language) {
    const languageClass = trimTextContent(language || "");
    const className = languageClass ? ` class="language-${escapeHtml(languageClass)}"` : "";
    return `<pre><code${className}>${escapeHtml((code || "").trim())}</code></pre>`;
  }

  function renderMarkdownListItem(line, ordered) {
    const source = line.trim();
    const content = source.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, "");
    const taskMatch = !ordered ? content.match(/^\[([ xX])\]\s+(.+)$/) : null;

    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === "x";
      return `
        <li class="task-item">
          <input type="checkbox" disabled ${checked ? "checked" : ""}>
          <span>${applyInlineMarkdown(escapeHtml(taskMatch[2]))}</span>
        </li>
      `;
    }

    return `<li>${applyInlineMarkdown(escapeHtml(content))}</li>`;
  }

  function isMarkdownTable(lines) {
    if (!Array.isArray(lines) || lines.length < 2) {
      return false;
    }

    if (!lines[0].includes("|") || !lines[1].includes("|")) {
      return false;
    }

    return /^[\s|:-]+$/.test(lines[1].trim());
  }

  function renderMarkdownTable(lines) {
    const headerCells = splitMarkdownTableRow(lines[0]);
    const bodyLines = lines.slice(2);

    return `
      <div class="table-wrap">
        <table class="markdown-table">
          <thead>
            <tr>${headerCells.map((cell) => `<th>${applyInlineMarkdown(escapeHtml(cell))}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${bodyLines
              .filter((line) => line.trim())
              .map((line) => {
                const cells = splitMarkdownTableRow(line);
                return `<tr>${cells.map((cell) => `<td>${applyInlineMarkdown(escapeHtml(cell))}</td>`).join("")}</tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function splitMarkdownTableRow(line) {
    return String(line || "")
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function getSafeMarkdownUrl(url) {
    const value = trimTextContent(url);
    if (!value) {
      return "";
    }

    if (
      value.startsWith("https://") ||
      value.startsWith("http://") ||
      value.startsWith("mailto:") ||
      value.startsWith("/")
    ) {
      return escapeHtml(value);
    }

    return "";
  }

  function trimTextContent(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "未知时间";
    }

    return date.toLocaleDateString("zh-CN");
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return "未知时间";
    }

    return date.toLocaleString("zh-CN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(remain).padStart(2, "0");
  }

  function getReadableGender(value) {
    return value || "未填写";
  }

  function getReadableBio(value) {
    return value && value.trim() ? value.trim() : "还没有填写";
  }

  function getLocationSummary(location) {
    if (!location || typeof location !== "object") {
      return "未填写";
    }

    const parts = [
      location.countryName,
      location.provinceName,
      location.cityName,
      location.countyName
    ].filter(Boolean);

    return parts.length ? parts.join(" / ") : "未填写";
  }

  function renderEmptyState(title, text) {
    return `
      <div class="empty-box">
        <p><strong>${escapeHtml(title)}</strong></p>
        <p>${escapeHtml(text)}</p>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------------

  function renderAvatar(user, className) {
    const safeAvatar = getSafeAvatar(user && user.avatar);
    if (safeAvatar) {
      return `<img class="${className}" src="${safeAvatar}" alt="${escapeHtml(user.name || "用户")} 的头像" />`;
    }

    const fallbackClass =
      className === "avatar"
        ? "avatar avatar-fallback"
        : className === "profile-avatar"
          ? "profile-avatar"
          : "avatar-placeholder";

    return `<div class="${fallbackClass}">${escapeHtml(((user && user.name) || "你").slice(0, 1) || "你")}</div>`;
  }

  function getSafeAvatar(value) {
    return typeof value === "string" && (value.startsWith("data:image/") || value.startsWith("/uploads/")) ? value : "";
  }

  function isValidPassword(password) {
    return /^[A-Za-z0-9]{8,16}$/.test(password) && /[A-Za-z]/.test(password) && /\d/.test(password);
  }

  async function optimizeAvatar(file, options) {
    const settings = Object.assign(
      {
        maxDimension: MAX_AVATAR_DIMENSION,
        maxOutputBytes: MAX_AVATAR_OUTPUT_BYTES,
        background: "#f7f2e8"
      },
      options || {}
    );
    const source = await readFileAsDataUrl(file);
    const image = await loadImage(source);

    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const scale = Math.min(1, settings.maxDimension / Math.max(width, height));

    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    let output = "";
    let quality = 0.9;
    let attempts = 0;

    while (attempts < 7) {
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("当前浏览器不支持头像压缩。");
      }

      context.clearRect(0, 0, width, height);
      context.fillStyle = settings.background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      output = canvas.toDataURL("image/jpeg", quality);
      if (estimateDataUrlBytes(output) <= settings.maxOutputBytes) {
        return output;
      }

      if (quality > 0.64) {
        quality -= 0.08;
      } else {
        width = Math.max(320, Math.round(width * 0.86));
        height = Math.max(320, Math.round(height * 0.86));
      }

      attempts += 1;
    }

    return output;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function () {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("头像读取失败。"));
      };
      reader.onerror = function () {
        reject(new Error("头像读取失败。"));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("头像图片无法解析，请换一张试试。"));
      };
      image.src = source;
    });
  }

  function estimateDataUrlBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1] || "";
    return Math.ceil((base64.length * 3) / 4);
  }

  async function uploadImageData(dataUrl, kind) {
    return apiRequest("/api/uploads/image", {
      method: "POST",
      body: {
        dataUrl,
        kind
      }
    });
  }

  function appendImageMarkdown(url) {
    const safeUrl = getSafeMarkdownUrl(url);
    if (!safeUrl) {
      return;
    }

    const imageLine = "![博客图片](" + url + ")";
    const nextContent = trimTextContent(state.blogDraft.content);

    state.blogDraft.content = nextContent ? nextContent + "\n\n" + imageLine : imageLine;
    syncBlogPreview();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function apiRequest(pathname, options) {
    const requestOptions = options || {};
    const headers = Object.assign({}, requestOptions.headers || {});

    if (requestOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (requestOptions.auth && state.sessionToken) {
      headers.Authorization = "Bearer " + state.sessionToken;
    }

    const response = await fetch(pathname, {
      method: requestOptions.method || "GET",
      headers,
      body: requestOptions.body !== undefined ? JSON.stringify(requestOptions.body) : undefined
    });

    const text = await response.text();
    let payload = {};

    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      payload = {};
    }

    if (!response.ok) {
      const requestError = new Error(payload.error || "请求失败，请稍后再试。");
      requestError.status = response.status;
      throw requestError;
    }

    return payload;
  }

  function readCachedUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.currentUser);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
        return parsed;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  function cleanupLegacyStorage() {
    LEGACY_STORAGE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        // Ignore localStorage cleanup failures.
      }
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
