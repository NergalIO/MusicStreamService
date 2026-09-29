package com.mss.android.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun LoginScreen(vm: AuthViewModel = hiltViewModel()) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val error by vm.error.collectAsState()
    val verify by vm.authVerify.collectAsState()
    val info by vm.authInfo.collectAsState()
    val url by vm.apiBase.collectAsState()
    var api by remember { mutableStateOf(url) }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("MusicStreamService", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(api, { api = it }, label = { Text("URL API") }, modifier = Modifier.fillMaxWidth())
        Button({ vm.setApiBase(api) }) { Text("Сохранить URL") }
        if (!verify) {
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Пароль") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button({ vm.login(email, password, register) }, Modifier.fillMaxWidth()) {
                Text(if (register) "Регистрация" else "Войти")
            }
            Button({ register = !register }, Modifier.fillMaxWidth()) {
                Text(if (register) "Уже есть аккаунт" else "Создать аккаунт")
            }
        } else {
            info?.let { Text(it) }
            OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Код") }, modifier = Modifier.fillMaxWidth())
            Button({ vm.verifyEmail(email, code) }, enabled = code.length == 6, modifier = Modifier.fillMaxWidth()) { Text("Подтвердить") }
            Button({ vm.resendVerification(email, password) }, Modifier.fillMaxWidth()) { Text("Отправить снова") }
            Button({ vm.cancelVerify() }, Modifier.fillMaxWidth()) { Text("Назад") }
        }
    }
}
