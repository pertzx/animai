/**
 * Termos de Uso e Política de Privacidade (prompt.txt item 15).
 * Texto-modelo: revise com um profissional jurídico antes do lançamento.
 */

import React from "react";
import { ArrowLeft } from "lucide-react";

const Shell: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="h-screen overflow-y-auto bg-bg text-fg">
    <div className="mx-auto max-w-2xl px-6 py-10">
      <a
        href="#/landing"
        className="mb-6 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft size={14} /> Voltar
      </a>
      <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
      <p className="mb-8 text-xs text-fg-muted">
        Última atualização: julho de 2026 · Documento-modelo — sujeito a
        revisão jurídica.
      </p>
      <div className="space-y-6 text-sm leading-relaxed text-fg-2 [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg">
        {children}
      </div>
    </div>
  </div>
);

export const TermsPage: React.FC = () => (
  <Shell title="Termos de Uso">
    <section>
      <h2>1. O serviço</h2>
      <p>
        O AnimAI é um editor de vídeo no navegador com assistente de
        inteligência artificial. Ao criar uma conta, você concorda com estes
        termos.
      </p>
    </section>
    <section>
      <h2>2. Sua conta</h2>
      <p>
        Você é responsável por manter a confidencialidade da sua senha e por
        toda atividade realizada na sua conta. Forneça informações verdadeiras
        no cadastro.
      </p>
    </section>
    <section>
      <h2>3. Seu conteúdo</h2>
      <p>
        Seus projetos e arquivos de mídia são seus e permanecem armazenados no
        seu dispositivo. Você declara ter os direitos necessários sobre o
        conteúdo que edita. Não use o serviço para produzir conteúdo ilegal,
        difamatório ou que viole direitos de terceiros.
      </p>
    </section>
    <section>
      <h2>4. Assistente de IA e limites de uso</h2>
      <p>
        O uso do assistente consome o saldo incluído no seu plano, exibido como
        percentual restante. O crédito de cortesia do plano gratuito é único e
        não renovável. Resultados gerados por IA podem conter erros — revise
        antes de publicar.
      </p>
    </section>
    <section>
      <h2>5. Pagamentos</h2>
      <p>
        Assinaturas são processadas pela Stripe e renovadas automaticamente até
        o cancelamento. O cancelamento vale para o ciclo seguinte; não há
        reembolso proporcional, salvo exigência legal.
      </p>
    </section>
    <section>
      <h2>6. Disponibilidade e alterações</h2>
      <p>
        O serviço é fornecido “como está”, sem garantias de disponibilidade
        ininterrupta. Podemos alterar funcionalidades e estes termos; mudanças
        relevantes serão comunicadas.
      </p>
    </section>
    <section>
      <h2>7. Encerramento</h2>
      <p>
        Podemos suspender contas que violem estes termos. Você pode encerrar
        sua conta a qualquer momento.
      </p>
    </section>
    <section>
      <h2>8. Contato</h2>
      <p>Dúvidas: pyerremarcio098@gmail.com.</p>
    </section>
  </Shell>
);

export const PrivacyPage: React.FC = () => (
  <Shell title="Política de Privacidade">
    <section>
      <h2>1. O que coletamos</h2>
      <p>
        Conta: nome, e-mail e senha (armazenada com hash). Uso do assistente:
        contadores de consumo para aplicar os limites do plano. Pagamentos: são
        processados pela Stripe; não armazenamos dados de cartão.
      </p>
    </section>
    <section>
      <h2>2. O que NÃO coletamos</h2>
      <p>
        Seus vídeos, áudios, imagens e projetos ficam no seu dispositivo
        (armazenamento local do navegador) e não são enviados aos nossos
        servidores. A transcrição de fala e a análise de mídia rodam localmente
        na sua máquina.
      </p>
    </section>
    <section>
      <h2>3. Assistente de IA</h2>
      <p>
        Ao usar o assistente, o texto das suas mensagens e um resumo do estado
        do projeto (nomes de arquivos, tempos, transcrições) são enviados ao
        provedor de IA configurado para gerar a resposta. Os arquivos de mídia
        em si nunca são enviados.
      </p>
    </section>
    <section>
      <h2>4. Compartilhamento</h2>
      <p>
        Não vendemos seus dados. Compartilhamos apenas com processadores
        necessários ao serviço (ex.: Stripe para pagamentos, provedor de IA
        para o assistente), sob seus próprios termos de proteção de dados.
      </p>
    </section>
    <section>
      <h2>5. Seus direitos (LGPD)</h2>
      <p>
        Você pode solicitar acesso, correção ou exclusão dos seus dados de
        conta a qualquer momento pelo e-mail de contato. A exclusão da conta
        remove seus dados dos nossos servidores; os projetos locais permanecem
        no seu dispositivo sob seu controle.
      </p>
    </section>
    <section>
      <h2>6. Segurança e retenção</h2>
      <p>
        Usamos criptografia em trânsito (HTTPS) e senhas com hash. Dados de
        conta são retidos enquanto a conta existir.
      </p>
    </section>
    <section>
      <h2>7. Contato</h2>
      <p>Encarregado de dados: pyerremarcio098@gmail.com.</p>
    </section>
  </Shell>
);
