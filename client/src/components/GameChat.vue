<template>
   <div class="chat-container">
      <div class="chat-window" ref="chatWindowRef">
         <div v-for="(msg, index) in messages" :key="index" class="message"
            :class="{ 'my-message': msg.isMe, 'opponent-message': !msg.isMe }">
            {{ msg.text }}
         </div>
      </div>

      <div class="chat-input">
         <input v-model="newMessage" @keyup.enter="onSend" placeholder="Write a message..." />
         <button @click="onSend">➤</button>
      </div>
   </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

// 1. Приймаємо повідомлення від батька (App.vue)
const props = defineProps({
   messages: {
      type: Array,
      required: true
   }
});

// 2. Визначаємо подію, щоб передати текст батькові
const emit = defineEmits(['send-message']);

const newMessage = ref('');
const chatWindowRef = ref(null);

const onSend = () => {
   if (newMessage.value.trim() === '') return;

   // Відправляємо текст наверх у App.vue
   emit('send-message', newMessage.value);
   newMessage.value = '';
};

// 3. Скрол вниз при зміні повідомлень (Логіка переїхала сюди, бо тут живе вікно чату)
watch(() => props.messages, async () => {
   await nextTick();
   if (chatWindowRef.value) {
      chatWindowRef.value.scrollTop = chatWindowRef.value.scrollHeight;
   }
}, { deep: true });
</script>

<style scoped>
.chat-container {
   margin-top: 30px;
   width: 100%;
   max-width: 300px;
   background: white;
   border-radius: 12px;
   box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
   overflow: hidden;
   border: 2px solid #a93d40;
   display: flex;
   flex-direction: column;
}

.chat-window {
   height: 130px;
   overflow-y: auto;
   padding: 15px;
   background-color: #ffffff;
   display: flex;
   flex-direction: column;
   gap: 10px;
   scroll-behavior: smooth;
}

.message {
   max-width: 80%;
   padding: 8px 12px;
   border-radius: 15px;
   font-size: 0.9rem;
   word-wrap: break-word;
}

.my-message {
   align-self: flex-end;
   background-color: #a93d40;
   color: #ffffff;
   border-bottom-right-radius: 2px;
}

.opponent-message {
   align-self: flex-start;
   background-color: white;
   color: #33393c;
   border: 1px solid #a93d40;
   border-bottom-left-radius: 2px;
}

.chat-input {
   display: flex;
   border-top: 1px solid #ddd;
}

.chat-input input {
   flex: 1;
   padding: 10px;
   border: none;
   outline: none;
   font-size: 16px;
   background-color: #fff;
}

.chat-input button {
   background-color: #a93d40;
   color: white;
   border: none;
   padding: 0 15px;
   cursor: pointer;
   font-size: 1.2rem;
}

.chat-input button:hover {
   background-color: #464a4c;
   transition: all .5s;
}

@media (max-width: 768px) {
   .chat-container {
      margin-top: 15px;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
   }

   .chat-window {
      height: 110px;
   }
}
</style>